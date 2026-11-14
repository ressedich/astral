import Foundation
import NetworkExtension

@MainActor
final class TunnelController: ObservableObject {
    @Published var status: NEVPNStatus = .invalid
    @Published var message = ""
    @Published var busy = false

    private var manager: NETunnelProviderManager?
    private var observer: NSObjectProtocol?

    var live: Bool { status == .connected || status == .connecting || status == .reasserting }

    init() {
        observer = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let connection = note.object as? NEVPNConnection else { return }
            Task { @MainActor in
                guard let self else { return }
                self.status = connection.status
                if connection.status == .connected {
                    self.message = ""
                } else if connection.status == .disconnected || connection.status == .invalid, let text = Vault.readError() {
                    self.message = text
                }
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
            manager = managers.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == Self.bundle }
            status = manager?.connection.status ?? .disconnected
        } catch {
            message = error.localizedDescription
        }
    }

    func disconnect() {
        manager?.connection.stopVPNTunnel()
    }

    func connect(_ server: ServerNode) async {
        if busy { return }
        busy = true
        message = ""
        Vault.clearError()
        defer { busy = false }
        if live {
            manager?.connection.stopVPNTunnel()
            for _ in 0..<50 {
                if !live { break }
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        do {
            let built = try RunConfig.make(server)
            guard Vault.writeConfig(built.json) else { throw ImportFailure(message: "Не удалось записать конфиг") }
            let tunnel = try await prepare(host: built.host)
            guard let session = tunnel.connection as? NETunnelProviderSession else {
                throw ImportFailure(message: "Нет сессии туннеля")
            }
            try session.startVPNTunnel(options: ["host": built.host as NSString])
            status = tunnel.connection.status
        } catch {
            message = error.localizedDescription
        }
    }

    private func prepare(host: String) async throws -> NETunnelProviderManager {
        let tunnel = manager ?? NETunnelProviderManager()
        let proto = (tunnel.protocolConfiguration as? NETunnelProviderProtocol) ?? NETunnelProviderProtocol()
        proto.providerBundleIdentifier = Self.bundle
        proto.serverAddress = host.isEmpty ? "Astral" : host
        proto.disconnectOnSleep = false
        proto.includeAllNetworks = true
        proto.excludeLocalNetworks = true
        proto.excludeAPNs = true
        proto.enforceRoutes = true
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
