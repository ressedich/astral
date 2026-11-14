import Darwin
import Foundation
import NetworkExtension

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let queue = DispatchQueue(label: "app.astral.tunnel")
    private var running = false

    override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
        var finished = false
        let finish: (Error?) -> Void = { error in
            if finished { return }
            finished = true
            completionHandler(error)
        }

        guard let config = SharedFiles.read("config.json"), !config.isEmpty else {
            finish(Self.failure("Нет конфигурации сервера"))
            return
        }
        guard let link = PhysicalLink.currentName() else {
            finish(Self.failure("Нет сети для выхода в интернет"))
            return
        }
        link.withCString { AstralSetInterface($0) }

        let host = options?["host"] as? String ?? ""
        let excluded = host.isEmpty ? [] : PhysicalLink.resolveIPv4(host)
        let settings = Self.networkSettings(excluded: excluded)

        setTunnelNetworkSettings(settings) { [weak self] error in
            guard let self else {
                finish(PacketTunnelProvider.failure("Расширение закрылось"))
                return
            }
            if let error {
                finish(error)
                return
            }
            let coreError = config.withCString { pointer -> String? in
                guard let raw = AstralStart(pointer) else { return nil }
                return String(cString: raw)
            }
            if let coreError {
                AstralStop()
                let message = "Ядро: \(coreError)"
                SharedFiles.write(message, name: "last-error.txt")
                finish(PacketTunnelProvider.failure(message))
                return
            }
            guard let fd = self.tunnelDescriptor() else {
                AstralStop()
                let message = "Система не отдала TUN"
                SharedFiles.write(message, name: "last-error.txt")
                finish(PacketTunnelProvider.failure(message))
                return
            }
            let yaml = Self.hevConfig
            self.running = true
            self.queue.async {
                let bytes = Array(yaml.utf8)
                bytes.withUnsafeBufferPointer { buffer in
                    guard let base = buffer.baseAddress else { return }
                    _ = hev_socks5_tunnel_main_from_str(base, UInt32(buffer.count), fd)
                }
            }
            SharedFiles.delete("last-error.txt")
            finish(nil)
        }
    }

    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        if running {
            hev_socks5_tunnel_quit()
            running = false
        }
        AstralStop()
        completionHandler()
    }

    private func tunnelDescriptor() -> Int32? {
        guard let number = packetFlow.value(forKeyPath: "socket.fileDescriptor") as? NSNumber else { return nil }
        let fd = number.int32Value
        return fd >= 0 ? fd : nil
    }

    private static func networkSettings(excluded: [String]) -> NEPacketTunnelNetworkSettings {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "10.7.0.1")
        let ipv4 = NEIPv4Settings(addresses: ["10.7.0.2"], subnetMasks: ["255.255.255.252"])
        ipv4.includedRoutes = [NEIPv4Route.default()]
        ipv4.excludedRoutes = excluded.map { NEIPv4Route(destinationAddress: $0, subnetMask: "255.255.255.255") }
        settings.ipv4Settings = ipv4
        let ipv6 = NEIPv6Settings(addresses: ["fd00:a571:a1::2"], networkPrefixLengths: [120])
        ipv6.includedRoutes = [NEIPv6Route.default()]
        settings.ipv6Settings = ipv6
        settings.mtu = 1400
        let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        dns.matchDomains = [""]
        settings.dnsSettings = dns
        return settings
    }

    private static func failure(_ message: String) -> NSError {
        NSError(domain: "Astral", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private static let hevConfig = """
    tunnel:
      mtu: 1400
      ipv4: 10.7.0.2
      ipv6: 'fd00:a571:a1::2'
    socks5:
      port: 10808
      address: 127.0.0.1
      udp: 'udp'
    misc:
      task-stack-size: 24576
      tcp-buffer-size: 4096
      max-session-count: 480
      connect-timeout: 5000
      read-write-timeout: 60000
      log-file: stderr
      log-level: error
    """
}

enum PhysicalLink {
    static func currentName() -> String? {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let head else { return nil }
        defer { freeifaddrs(head) }
        var wifi: String?
        var cell: String?
        var cursor: UnsafeMutablePointer<ifaddrs>? = head
        while let item = cursor {
            cursor = item.pointee.ifa_next
            let flags = Int32(item.pointee.ifa_flags)
            if flags & IFF_UP == 0 || flags & IFF_LOOPBACK != 0 { continue }
            guard let address = item.pointee.ifa_addr, address.pointee.sa_family == UInt8(AF_INET) else { continue }
            let name = String(cString: item.pointee.ifa_name)
            let ip = address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { UInt32(bigEndian: $0.pointee.sin_addr.s_addr) }
            if ip == 0 || (ip & 0xFFFF0000) == 0xA9FE0000 { continue }
            if name.hasPrefix("en"), wifi == nil { wifi = name }
            if name.hasPrefix("pdp_ip"), cell == nil { cell = name }
        }
        return wifi ?? cell
    }

    static func resolveIPv4(_ host: String) -> [String] {
        var hints = addrinfo()
        hints.ai_family = AF_INET
        hints.ai_socktype = SOCK_STREAM
        var info: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &info) == 0, let info else { return [] }
        defer { freeaddrinfo(info) }
        var found: [String] = []
        var cursor: UnsafeMutablePointer<addrinfo>? = info
        while let item = cursor {
            if let address = item.pointee.ai_addr, item.pointee.ai_family == AF_INET {
                var sin = address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee }
                var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                inet_ntop(AF_INET, &sin.sin_addr, &buffer, socklen_t(INET_ADDRSTRLEN))
                let text = String(cString: buffer)
                if !text.isEmpty && !found.contains(text) { found.append(text) }
            }
            cursor = item.pointee.ai_next
        }
        return found
    }
}

enum SharedFiles {
    static func directory() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.app.astral.ios")
    }

    static func read(_ name: String) -> String? {
        guard let url = directory()?.appendingPathComponent(name) else { return nil }
        return try? String(contentsOf: url, encoding: .utf8)
    }

    static func write(_ text: String, name: String) {
        guard let url = directory()?.appendingPathComponent(name) else { return }
        try? text.write(to: url, atomically: true, encoding: .utf8)
    }

    static func delete(_ name: String) {
        guard let url = directory()?.appendingPathComponent(name) else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
