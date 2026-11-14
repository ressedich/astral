import Foundation
import NetworkExtension

@MainActor
final class TunnelController: ObservableObject {
    @Published var status: NEVPNStatus = .invalid
    @Published var message = ""
    @Published var busy = false
    @Published var checked = false
    @Published var installed = false

    private var manager: NETunnelProviderManager?
    private var observer: NSObjectProtocol?
    private var ignoreNextDrop = false

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
                } else if connection.status == .disconnected || connection.status == .invalid {
                    if self.ignoreNextDrop {
                        self.ignoreNextDrop = false
                        return
                    }
                    connection.fetchLastDisconnectError { error in
                        let stored = Vault.readError()
                        Task { @MainActor in
                            if let error = error as NSError?, error.domain == "Astral" {
                                self.message = error.localizedDescription
                            } else if let stored {
                                self.message = stored
                            } else if let error, !error.localizedDescription.isEmpty {
                                self.message = error.localizedDescription
                            }
                        }
                    }
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
            installed = manager != nil
            status = manager?.connection.status ?? .disconnected
            checked = true
        } catch {
            checked = true
            message = error.localizedDescription
        }
    }

    nonisolated static func configure(_ tunnel: NETunnelProviderManager) {
        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = bundle
        proto.serverAddress = "Astral"
        proto.disconnectOnSleep = false
        tunnel.protocolConfiguration = proto
        tunnel.localizedDescription = "Astral"
        tunnel.isEnabled = true
    }

    func accept(_ saved: NETunnelProviderManager) async {
        manager = saved
        installed = true
        status = saved.connection.status
        message = ""
        do {
            try await saved.loadFromPreferences()
            status = saved.connection.status
        } catch {
            message = Self.describe(error)
        }
    }

    func disconnect() {
        ignoreNextDrop = true
        message = ""
        manager?.connection.stopVPNTunnel()
    }

    func connect(_ server: ServerNode) async {
        if busy { return }
        busy = true
        message = ""
        Vault.clearError()
        defer { busy = false }
        if live {
            ignoreNextDrop = true
            manager?.connection.stopVPNTunnel()
            for _ in 0..<50 {
                if !live { break }
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        do {
            let built = try RunConfig.make(server)
            Vault.writeConfig(built.json)
            let tunnel = try await prepare(host: built.host)
            guard let session = tunnel.connection as? NETunnelProviderSession else {
                throw ImportFailure(message: "Нет сессии туннеля")
            }
            try session.startVPNTunnel(options: [
                "host": built.host as NSString,
                "config": built.json as NSString,
            ])
            status = tunnel.connection.status
        } catch {
            message = Self.describe(error)
        }
    }

    private func prepare(host: String) async throws -> NETunnelProviderManager {
        let tunnel = manager ?? NETunnelProviderManager()
        let proto = (tunnel.protocolConfiguration as? NETunnelProviderProtocol) ?? NETunnelProviderProtocol()
        proto.providerBundleIdentifier = Self.bundle
        proto.serverAddress = host.isEmpty ? "Astral" : host
        proto.disconnectOnSleep = false
        proto.providerConfiguration = nil
        tunnel.protocolConfiguration = proto
        tunnel.localizedDescription = "Astral"
        tunnel.isEnabled = true
        try await tunnel.saveToPreferences()
        try await tunnel.loadFromPreferences()
        manager = tunnel
        return tunnel
    }

    nonisolated static let bundle = "app.astral.ios.tunnel"

    nonisolated static func describe(_ error: Error) -> String {
        let ns = error as NSError
        let denied = ns.domain == "NEConfigurationErrorDomain" && ns.code == 10
            || ns.localizedDescription.localizedCaseInsensitiveContains("permission denied")
        if denied {
            return "iOS не записал VPN, поэтому Astral нет в Настройках. Окно «Разрешить» появляется только с Network Extension в подписи app.astral.ios и app.astral.ios.tunnel. (\(ns.domain) \(ns.code))"
        }
        let text = ns.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            return "Не удалось сохранить VPN (\(ns.domain) \(ns.code))."
        }
        return "\(text) (\(ns.domain) \(ns.code))"
    }
}
