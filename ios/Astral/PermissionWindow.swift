import NetworkExtension
import UIKit

enum PermissionWindow {
    private static var visible = false

    static func present(onSaved: @escaping (NETunnelProviderManager) -> Void) {
        guard !visible, let root = top() else { return }
        let controller = PermissionController()
        controller.onSaved = { manager in
            visible = false
            onSaved(manager)
        }
        controller.onClose = { visible = false }
        controller.modalPresentationStyle = .overFullScreen
        controller.modalTransitionStyle = .crossDissolve
        visible = true
        root.present(controller, animated: true)
    }

    private static func top() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        let window = scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first
        var controller = window?.rootViewController
        while let next = controller?.presentedViewController { controller = next }
        return controller
    }
}

private final class PermissionController: UIViewController {
    var onSaved: ((NETunnelProviderManager) -> Void)?
    var onClose: (() -> Void)?

    private let manager = NETunnelProviderManager()
    private let status = UILabel()
    private var saving = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.55)

        let card = UIView()
        card.backgroundColor = UIColor(white: 0.11, alpha: 1)
        card.layer.cornerRadius = 20
        card.layer.borderWidth = 1
        card.layer.borderColor = UIColor.white.withAlphaComponent(0.12).cgColor
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        let title = UILabel()
        title.text = "Подключить VPN"
        title.textColor = .white
        title.font = .systemFont(ofSize: 18, weight: .semibold)

        let body = UILabel()
        body.text = "Astral появляется в Настройках только после системного окна «Разрешить»."
        body.textColor = UIColor.white.withAlphaComponent(0.72)
        body.font = .systemFont(ofSize: 14)
        body.numberOfLines = 0

        let box = UIView()
        box.backgroundColor = .white
        box.layer.cornerRadius = 10
        box.clipsToBounds = true
        status.text = SignReport.text()
        status.textColor = .black
        status.font = .systemFont(ofSize: 13, weight: .medium)
        status.numberOfLines = 0
        status.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(status)

        let button = UIButton(type: .custom)
        button.setTitle("Подключить", for: .normal)
        button.setTitleColor(UIColor(white: 0.067, alpha: 1), for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        button.backgroundColor = .white
        button.layer.cornerRadius = 16
        button.addTarget(self, action: #selector(connectTapped), for: .touchUpInside)

        let later = UIButton(type: .system)
        later.setTitle("Позже", for: .normal)
        later.setTitleColor(UIColor.white.withAlphaComponent(0.72), for: .normal)
        later.titleLabel?.font = .systemFont(ofSize: 15, weight: .medium)
        later.addTarget(self, action: #selector(close), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, body, box, button, later])
        stack.axis = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 18),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -18),
            status.topAnchor.constraint(equalTo: box.topAnchor, constant: 10),
            status.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -10),
            status.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 10),
            status.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -10),
            button.heightAnchor.constraint(equalToConstant: 48),
        ])

        TunnelController.configure(manager)
        manager.loadFromPreferences { [weak self] _ in
            DispatchQueue.main.async {
                guard let self, !self.saving else { return }
                TunnelController.configure(self.manager)
            }
        }
    }

    @objc private func connectTapped() {
        if saving { return }
        saving = true
        TunnelController.configure(manager)
        let manager = manager
        manager.saveToPreferences { [weak self] error in
            DispatchQueue.main.async {
                guard let self else { return }
                self.saving = false
                if let error {
                    self.status.text = TunnelController.describe(error)
                    return
                }
                let done = self.onSaved
                self.dismiss(animated: true) {
                    done?(manager)
                }
            }
        }
    }

    @objc private func close() {
        let done = onClose
        dismiss(animated: true) { done?() }
    }
}

private enum SignReport {
    static func text() -> String {
        let app = Bundle.main.bundleURL.appendingPathComponent("embedded.mobileprovision")
        let tunnel = Bundle.main.builtInPlugInsURL?.appendingPathComponent("PacketTunnel.appex/embedded.mobileprovision")
        let appData = try? Data(contentsOf: app)
        let tunnelData = tunnel.flatMap { try? Data(contentsOf: $0) }
        let mark = Data("packet-tunnel-provider".utf8)
        let appOK = appData?.range(of: mark) != nil
        let tunnelOK = tunnelData?.range(of: mark) != nil
        var lines = [
            line("Приложение", appData, appOK),
            tunnel == nil ? "Туннель: расширение не вложено" : line("Туннель", tunnelData, tunnelOK),
        ]
        if appOK && tunnelOK {
            lines.append("Подпись в порядке. Нажмите «Подключить», затем «Разрешить» в системном окне.")
        } else {
            lines.append("В подписи нет Network Extension. iOS поэтому не создаёт Astral в Настройках и не показывает «Разрешить». Нужны платные профили app.astral.ios и app.astral.ios.tunnel.")
        }
        return lines.joined(separator: "\n")
    }

    private static func line(_ name: String, _ data: Data?, _ ok: Bool) -> String {
        if data == nil { return "\(name): профиль не найден" }
        return ok ? "\(name): Network Extension есть" : "\(name): Network Extension нет"
    }
}
