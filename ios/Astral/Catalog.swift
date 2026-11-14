import Darwin
import Foundation
import Network

struct Subscription: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var url: String
    var announce: String
    var expire: Int?
    var updated: TimeInterval
}

struct ServerNode: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var host: String
    var port: Int
    var subId: String
    var outboundsJSON: Data
    var dnsJSON: Data?
}

struct Profile: Codable, Equatable {
    var subscriptions: [Subscription] = []
    var servers: [ServerNode] = []
    var selected: String = ""

    var current: ServerNode? {
        servers.first { $0.id == selected } ?? servers.first
    }
}

struct ImportFailure: LocalizedError {
    var message: String
    var errorDescription: String? { message }
}

enum Vault {
    private static let suite = "group.app.astral.ios"

    static func directory() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suite)
    }

    static func load() -> Profile {
        guard let url = directory()?.appendingPathComponent("profile.json"),
              let data = try? Data(contentsOf: url),
              let profile = try? JSONDecoder().decode(Profile.self, from: data) else { return Profile() }
        return profile
    }

    static func save(_ profile: Profile) {
        guard let url = directory()?.appendingPathComponent("profile.json"),
              let data = try? JSONEncoder().encode(profile) else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func writeConfig(_ json: String) -> Bool {
        guard let url = directory()?.appendingPathComponent("config.json") else { return false }
        do {
            try json.write(to: url, atomically: true, encoding: .utf8)
            return true
        } catch {
            return false
        }
    }

    static func readError() -> String? {
        guard let url = directory()?.appendingPathComponent("last-error.txt") else { return nil }
        let text = (try? String(contentsOf: url, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines)
        return text?.isEmpty == false ? text : nil
    }

    static func clearError() {
        guard let url = directory()?.appendingPathComponent("last-error.txt") else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

enum RunConfig {
    static func make(_ server: ServerNode) throws -> (json: String, host: String, port: Int) {
        guard let raw = try JSONSerialization.jsonObject(with: server.outboundsJSON) as? [Any] else {
            throw ImportFailure(message: "Конфиг сервера повреждён")
        }
        let outbounds = raw.compactMap { $0 as? [String: Any] }
        let proxies = outbounds.filter { preference($0) < 50 }.sorted { preference($0) < preference($1) }
        let mirrors = proxies.filter { tag(of: $0) == "main" || tag(of: $0).hasSuffix("-2") }
        guard var chosen = (mirrors.first ?? proxies.first), let end = endpoint(chosen) else {
            throw ImportFailure(message: "У сервера нет исходящего подключения")
        }
        if tag(of: chosen).isEmpty { chosen["tag"] = "proxy" }
        let chosenTag = tag(of: chosen)
        var direct = outbounds.first { ($0["protocol"] as? String) == "freedom" } ?? ["protocol": "freedom", "tag": "direct"]
        direct["tag"] = "direct"
        var block = outbounds.first { ($0["protocol"] as? String) == "blackhole" } ?? ["protocol": "blackhole", "tag": "block"]
        block["tag"] = "block"
        let slim: [[String: Any]] = [chosen, direct, block]
        let config: [String: Any] = [
            "log": ["loglevel": "warning"],
            "dns": dns(from: server.dnsJSON),
            "policy": ["levels": ["0": ["handshake": 4, "connIdle": 300, "uplinkOnly": 1, "downlinkOnly": 2]]],
            "routing": [
                "domainStrategy": "AsIs",
                "rules": [
                    [
                        "type": "field",
                        "ip": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16"],
                        "outboundTag": "direct",
                    ],
                    ["type": "field", "network": "tcp,udp", "outboundTag": chosenTag],
                ],
            ],
            "inbounds": [[
                "tag": "socks-in",
                "listen": "127.0.0.1",
                "port": 10808,
                "protocol": "socks",
                "settings": ["auth": "noauth", "udp": true],
            ]],
            "outbounds": slim,
        ]
        let data = try JSONSerialization.data(withJSONObject: config)
        guard let json = String(data: data, encoding: .utf8) else {
            throw ImportFailure(message: "Не собрал конфиг")
        }
        return (json, end.host, end.port)
    }

    static func endpoint(of server: ServerNode) -> (host: String, port: Int) {
        (try? make(server)).map { ($0.host, $0.port) } ?? (server.host, server.port)
    }

    private static func dns(from data: Data?) -> [String: Any] {
        let fallback: [String: Any] = ["queryStrategy": "UseIPv4", "servers": ["1.1.1.1", "8.8.8.8"]]
        guard let data, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return fallback }
        var copy = object
        copy["queryStrategy"] = "UseIPv4"
        return copy
    }

    private static func preference(_ item: [String: Any]) -> Int {
        let proto = item["protocol"] as? String ?? ""
        if ["freedom", "blackhole", "dns", "loopback"].contains(proto) { return 50 }
        let name = tag(of: item)
        if name == "main" || name.hasSuffix("-2") { return 0 }
        if name == "proxy" { return 30 }
        return 10
    }

    private static func tag(of item: [String: Any]) -> String {
        item["tag"] as? String ?? ""
    }

    private static func endpoint(_ item: [String: Any]) -> (host: String, port: Int)? {
        let settings = item["settings"] as? [String: Any]
        let proto = item["protocol"] as? String ?? ""
        if proto == "vless" || proto == "vmess" || proto == "trojan" {
            guard let hop = (settings?["vnext"] as? [Any])?.first as? [String: Any],
                  let host = hop["address"] as? String,
                  let port = number(hop["port"]) else { return nil }
            return (host, port)
        }
        if let host = settings?["address"] as? String, let port = number(settings?["port"]) {
            return (host, port)
        }
        return nil
    }

    private static func number(_ value: Any?) -> Int? {
        switch value {
        case let value as Int: return value
        case let value as NSNumber: return value.intValue
        default: return nil
        }
    }
}

enum Importer {
    static func load(source: String, into profile: Profile) async throws -> Profile {
        let text = source.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { throw ImportFailure(message: "Вставьте ссылку или vless://") }
        if text.range(of: "vless://", options: .caseInsensitive) != nil {
            let servers = parseLinks(text)
            if servers.isEmpty { throw ImportFailure(message: "Не разобрал ни одной ссылки vless") }
            let name = servers.count == 1 ? servers[0].name : "Мои"
            return merge(name: name, url: "", announce: "", expire: nil, servers: servers, into: profile)
        }
        guard text.lowercased().hasPrefix("http://") || text.lowercased().hasPrefix("https://"),
              let url = URL(string: text.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? text) else {
            throw ImportFailure(message: "Нужна ссылка подписки или vless://")
        }
        let fetched = try await fetch(url)
        let unpacked = unpack(fetched.body)
        let servers = parseConfigs(unpacked) ?? parseLinks(unpacked)
        if servers.isEmpty { throw ImportFailure(message: "В подписке нет поддерживаемых серверов") }
        return merge(name: fetched.title.isEmpty ? url.host ?? "Подписка" : fetched.title, url: url.absoluteString, announce: fetched.announce, expire: fetched.expire, servers: servers, into: profile)
    }

    private static func merge(name: String, url: String, announce: String, expire: Int?, servers: [ServerNode], into profile: Profile) -> Profile {
        var next = profile
        let existing = url.isEmpty ? nil : next.subscriptions.first { $0.url == url }
        let subId = existing?.id ?? UUID().uuidString
        let subscription = Subscription(id: subId, name: clean(name, 80).isEmpty ? "Подписка" : clean(name, 80), url: url, announce: announce, expire: expire, updated: Date().timeIntervalSince1970)
        if let index = next.subscriptions.firstIndex(where: { $0.id == subId }) {
            next.subscriptions[index] = subscription
        } else {
            next.subscriptions.append(subscription)
        }
        let previous = next.servers.first { $0.id == next.selected }?.name
        next.servers.removeAll { $0.subId == subId }
        next.servers.append(contentsOf: servers.map { server in
            var copy = server
            copy.subId = subId
            return copy
        })
        if let previous, let match = next.servers.first(where: { $0.subId == subId && $0.name == previous }) {
            next.selected = match.id
        } else if !next.servers.contains(where: { $0.id == next.selected }) {
            next.selected = next.servers.first { $0.subId == subId }?.id ?? next.servers.first?.id ?? ""
        }
        return next
    }

    private static func fetch(_ url: URL) async throws -> (body: String, title: String, announce: String, expire: Int?) {
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.setValue("v2rayNG/1.8.29", forHTTPHeaderField: "User-Agent")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw ImportFailure(message: "Подписка не ответила")
        }
        let http = response as? HTTPURLResponse
        if let status = http?.statusCode, !(200..<300).contains(status) {
            throw ImportFailure(message: "Подписка ответила \(status)")
        }
        if data.count > 2_000_000 { throw ImportFailure(message: "Подписка слишком большая") }
        guard let body = String(data: data, encoding: .utf8) else { throw ImportFailure(message: "Пустой ответ подписки") }
        let title = headerText(http?.value(forHTTPHeaderField: "profile-title") ?? http?.value(forHTTPHeaderField: "content-disposition"), limit: 80)
        let announce = headerText(http?.value(forHTTPHeaderField: "announce"), limit: 500).replacingOccurrences(of: "\r", with: "")
        return (body, title, announce, userExpire(http?.value(forHTTPHeaderField: "subscription-userinfo")))
    }

    private static func parseConfigs(_ text: String) -> [ServerNode]? {
        guard text.hasPrefix("[") || text.hasPrefix("{"),
              let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) else { return nil }
        let list: [[String: Any]]
        if let array = json as? [[String: Any]] {
            list = array
        } else if let one = json as? [String: Any], one["outbounds"] != nil {
            list = [one]
        } else {
            return nil
        }
        return list.compactMap(server(from:))
    }

    private static func server(from config: [String: Any]) -> ServerNode? {
        guard let raw = config["outbounds"] as? [Any] else { return nil }
        let outbounds = raw.compactMap { $0 as? [String: Any] }
        guard let data = try? JSONSerialization.data(withJSONObject: outbounds) else { return nil }
        let proxies = outbounds.filter { ($0["protocol"] as? String).map { !["freedom", "blackhole", "dns", "loopback"].contains($0) } ?? false }
        guard let sample = proxies.first else { return nil }
        let settings = sample["settings"] as? [String: Any]
        let host = ((settings?["vnext"] as? [Any])?.first as? [String: Any])?["address"] as? String ?? settings?["address"] as? String ?? ""
        let portValue = ((settings?["vnext"] as? [Any])?.first as? [String: Any])?["port"] ?? settings?["port"]
        let port = (portValue as? NSNumber)?.intValue ?? (portValue as? Int) ?? 443
        if host.isEmpty { return nil }
        let remarks = config["remarks"] as? String ?? config["ps"] as? String ?? sample["tag"] as? String ?? host
        var dns: Data?
        if let object = config["dns"], JSONSerialization.isValidJSONObject(object) {
            dns = try? JSONSerialization.data(withJSONObject: object)
        }
        return ServerNode(id: UUID().uuidString, name: clean(remarks, 80).isEmpty ? host : clean(remarks, 80), host: host, port: port, subId: "", outboundsJSON: data, dnsJSON: dns)
    }

    private static func parseLinks(_ text: String) -> [ServerNode] {
        text.split(whereSeparator: \.isNewline).compactMap { parseVless(String($0).trimmingCharacters(in: .whitespaces)) }
    }

    private static func parseVless(_ line: String) -> ServerNode? {
        guard line.lowercased().hasPrefix("vless://") else { return nil }
        let body = String(line.dropFirst("vless://".count))
        let hash = body.lastIndex(of: "#")
        var name = hash.map { String(body[$0...].dropFirst()) } ?? ""
        name = name.removingPercentEncoding ?? name.replacingOccurrences(of: "%20", with: " ")
        let main = hash.map { String(body[..<$0]) } ?? body
        let queryAt = main.firstIndex(of: "?")
        let params = URLComponents(string: "https://local/\(queryAt.map { String(main[$0...]) } ?? "")")?.queryItems ?? []
        let address = queryAt.map { String(main[..<$0]) } ?? main
        guard let at = address.lastIndex(of: "@"), at > address.startIndex else { return nil }
        let uuid = String(address[..<at]).removingPercentEncoding ?? String(address[..<at])
        let hostport = String(address[address.index(after: at)...])
        let host: String
        let port: Int
        if hostport.hasPrefix("[") {
            guard let end = hostport.firstIndex(of: "]"),
                  let portStart = hostport.index(end, offsetBy: 2, limitedBy: hostport.index(before: hostport.endIndex)) else { return nil }
            host = String(hostport[hostport.index(after: hostport.startIndex)..<end])
            port = Int(hostport[portStart...]) ?? 0
        } else {
            guard let colon = hostport.lastIndex(of: ":") else { return nil }
            host = String(hostport[..<colon])
            port = Int(hostport[hostport.index(after: colon)...]) ?? 0
        }
        guard !host.isEmpty, (1...65535).contains(port), uuid.range(of: #"^[0-9a-fA-F-]{8,80}$"#, options: .regularExpression) != nil else { return nil }
        func pick(_ key: String) -> String {
            clean(params.first { $0.name == key }?.value ?? "", 300)
        }
        let network = (pick("type").isEmpty ? pick("network") : pick("type")).lowercased()
        let security = (pick("security").isEmpty ? "none" : pick("security")).lowercased()
        let link = VlessLink(name: clean(name, 80).isEmpty ? host : clean(name, 80), host: host, port: port, uuid: uuid, flow: pick("flow"), network: network.isEmpty ? "tcp" : network, security: security, sni: pick("sni").isEmpty ? pick("serverName") : pick("sni"), fp: pick("fp").isEmpty ? pick("fingerprint") : pick("fp"), pbk: pick("pbk").isEmpty ? pick("publicKey") : pick("pbk"), sid: pick("sid").isEmpty ? pick("shortId") : pick("sid"), path: pick("path"), hostHeader: pick("host").isEmpty ? pick("authority") : pick("host"), serviceName: pick("serviceName").isEmpty ? pick("service_name") : pick("serviceName"), alpn: pick("alpn"), mode: pick("mode"))
        let outbound = vlessOutbound(link)
        guard let data = try? JSONSerialization.data(withJSONObject: [outbound]) else { return nil }
        return ServerNode(id: UUID().uuidString, name: link.name, host: host, port: port, subId: "", outboundsJSON: data, dnsJSON: nil)
    }

    private static func vlessOutbound(_ link: VlessLink) -> [String: Any] {
        var stream: [String: Any] = ["network": "tcp", "security": "none"]
        if link.security == "reality" {
            stream["security"] = "reality"
            stream["realitySettings"] = [
                "serverName": link.sni.isEmpty ? link.host : link.sni,
                "fingerprint": link.fp.isEmpty ? "chrome" : link.fp,
                "publicKey": link.pbk,
                "shortId": link.sid,
            ]
        } else if link.security == "tls" {
            stream["security"] = "tls"
            var tls: [String: Any] = ["serverName": link.sni.isEmpty ? link.host : link.sni]
            if !link.fp.isEmpty { tls["fingerprint"] = link.fp }
            if !link.alpn.isEmpty {
                tls["alpn"] = link.alpn.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            }
            stream["tlsSettings"] = tls
        }
        switch link.network {
        case "ws":
            stream["network"] = "ws"
            var headers: [String: String] = [:]
            if !link.hostHeader.isEmpty { headers["Host"] = link.hostHeader }
            stream["wsSettings"] = ["path": link.path.isEmpty ? "/" : link.path, "headers": headers]
        case "grpc":
            stream["network"] = "grpc"
            stream["grpcSettings"] = ["serviceName": link.serviceName]
        case "httpupgrade":
            stream["network"] = "httpupgrade"
            var settings: [String: Any] = ["path": link.path.isEmpty ? "/" : link.path]
            if !link.hostHeader.isEmpty { settings["host"] = link.hostHeader }
            stream["httpupgradeSettings"] = settings
        case "xhttp", "splithttp":
            stream["network"] = "xhttp"
            var settings: [String: Any] = ["path": link.path.isEmpty ? "/" : link.path]
            if !link.hostHeader.isEmpty { settings["host"] = link.hostHeader }
            if !link.mode.isEmpty { settings["mode"] = link.mode }
            stream["xhttpSettings"] = settings
        default:
            break
        }
        var user: [String: Any] = ["id": link.uuid, "encryption": "none"]
        if !link.flow.isEmpty { user["flow"] = link.flow }
        return [
            "tag": "proxy",
            "protocol": "vless",
            "settings": ["vnext": [["address": link.host, "port": link.port, "users": [user]]]],
            "streamSettings": stream,
        ]
    }

    private static func unpack(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("[") || trimmed.hasPrefix("{") || trimmed.contains("://") { return trimmed }
        if let decoded = decodeBase64(trimmed) {
            let packed = decoded.trimmingCharacters(in: .whitespacesAndNewlines)
            if packed.hasPrefix("[") || packed.hasPrefix("{") || packed.contains("://") { return packed }
        }
        return trimmed
    }

    private static func headerText(_ value: String?, limit: Int) -> String {
        let raw = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if raw.lowercased().hasPrefix("base64:") {
            return clean(decodeBase64(String(raw.dropFirst(7))) ?? "", limit)
        }
        return clean(raw, limit)
    }

    private static func userExpire(_ header: String?) -> Int? {
        for part in header?.split(separator: ";") ?? [] {
            let bits = part.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard bits.count == 2, bits[0].lowercased() == "expire", let value = Int(bits[1]), value > 0 else { continue }
            return value
        }
        return nil
    }

    private static func decodeBase64(_ input: String) -> String? {
        var compact = input.replacingOccurrences(of: "\\s+", with: "", options: .regularExpression)
        guard compact.count >= 16 else { return nil }
        compact = compact.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        compact += String(repeating: "=", count: (4 - compact.count % 4) % 4)
        guard let data = Data(base64Encoded: compact), let text = String(data: data, encoding: .utf8), !text.contains("\u{FFFD}") else { return nil }
        return text
    }

    private static func clean(_ value: String, _ limit: Int) -> String {
        String(value.trimmingCharacters(in: .whitespacesAndNewlines).prefix(limit))
    }
}

private struct VlessLink {
    var name: String
    var host: String
    var port: Int
    var uuid: String
    var flow: String
    var network: String
    var security: String
    var sni: String
    var fp: String
    var pbk: String
    var sid: String
    var path: String
    var hostHeader: String
    var serviceName: String
    var alpn: String
    var mode: String
}

enum Probe {
    static func tcp(host: String, port: Int) async -> Int {
        let resolved = await Task.detached(priority: .userInitiated) { resolve(host) }.value
        guard let ip = resolved, let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else { return -1 }
        return await withCheckedContinuation { continuation in
            let connection = NWConnection(host: .init(ip), port: nwPort, using: .tcp)
            let box = ResumeBox(continuation)
            let start = DispatchTime.now()
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    let ms = Int((DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000)
                    connection.cancel()
                    box.finish(max(ms, 1))
                case .failed:
                    connection.cancel()
                    box.finish(-1)
                default:
                    break
                }
            }
            connection.start(queue: .global(qos: .userInitiated))
            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 1.2) {
                connection.cancel()
                box.finish(-1)
            }
        }
    }

    private static func resolve(_ host: String) -> String? {
        var hints = addrinfo()
        hints.ai_family = AF_INET
        hints.ai_socktype = SOCK_STREAM
        var info: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &info) == 0, let info else { return nil }
        defer { freeaddrinfo(info) }
        guard let address = info.pointee.ai_addr else { return nil }
        var sin = address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee }
        var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        guard inet_ntop(AF_INET, &sin.sin_addr, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil else { return nil }
        let text = String(cString: buffer)
        return text.isEmpty ? nil : text
    }
}

private final class ResumeBox: @unchecked Sendable {
    private var continuation: CheckedContinuation<Int, Never>?
    private let lock = NSLock()

    init(_ continuation: CheckedContinuation<Int, Never>) {
        self.continuation = continuation
    }

    func finish(_ value: Int) {
        lock.lock()
        let current = continuation
        continuation = nil
        lock.unlock()
        current?.resume(returning: value)
    }
}

enum When {
    static func day(_ unix: Int?) -> String {
        guard let unix, unix > 0 else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "d MMM yyyy"
        return "до " + formatter.string(from: Date(timeIntervalSince1970: TimeInterval(unix)))
    }

    static func updated(_ interval: TimeInterval) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "d MMM, HH:mm"
        return formatter.string(from: Date(timeIntervalSince1970: interval))
    }
}
