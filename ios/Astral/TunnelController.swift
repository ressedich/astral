import Foundation
import NetworkExtension

@MainActor
final class TunnelController: ObservableObject {
    @Published var status: NEVPNStatus = .invalid
    @Published var message = ""
    @Published var busy = false

    private var manager: NETunnelProviderManager?
    private var observer: NSObjectProtocol?

    var live: Bool { status == .connected || status == .connecting }

    init() {
        observer = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let connection = note.object as? NEVPNConnection else { return }
            Task { @MainActor in
                self?.status = connection.status
            }
        }
        Task { await reload() }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    func reload() async {
        do {
            let managers = try await NETunnelProviderManager.loadAllFromPreferences()
            manager = managers.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == TunnelController.bundle }
            status = manager?.connection.status ?? .disconnected
        } catch {
            message = error.localizedDescription
        }
    }

    func toggle(server: ServerRecord) async {
        if live {
            manager?.connection.stopVPNTunnel()
            return
        }
        busy = true
        message = ""
        defer { busy = false }
        do {
            let tunnel = try await prepare(server: server)
            try tunnel.connection.startVPNTunnel()
            status = tunnel.connection.status
        } catch {
            message = error.localizedDescription
        }
    }

    private func prepare(server: ServerRecord) async throws -> NETunnelProviderManager {
        let tunnel = manager ?? NETunnelProviderManager()
        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = Self.bundle
        proto.serverAddress = server.host.isEmpty ? "Astral" : server.host
        proto.disconnectOnSleep = false
        tunnel.protocolConfiguration = proto
        tunnel.localizedDescription = "Astral"
        tunnel.isEnabled = true
        try await tunnel.saveToPreferences()
        try await tunnel.loadFromPreferences()
        manager = tunnel
        return tunnel
    }

    static let bundle = "app.astral.ios.tunnel"
}

struct ServerRecord: Identifiable, Codable, Equatable {
    var id: String
    var name: String
    var host: String
}

enum ServerStore {
    private static let key = "servers"
    private static let selectedKey = "selected"

    static func load() -> (servers: [ServerRecord], selected: String) {
        let defaults = UserDefaults(suiteName: "group.app.astral.ios") ?? .standard
        let servers = (try? JSONDecoder().decode([ServerRecord].self, from: defaults.data(forKey: key) ?? Data())) ?? []
        let selected = defaults.string(forKey: selectedKey) ?? servers.first?.id ?? ""
        return (servers, selected)
    }

    static func save(servers: [ServerRecord], selected: String) {
        let defaults = UserDefaults(suiteName: "group.app.astral.ios") ?? .standard
        if let data = try? JSONEncoder().encode(servers) {
            defaults.set(data, forKey: key)
        }
        defaults.set(selected, forKey: selectedKey)
    }
}
