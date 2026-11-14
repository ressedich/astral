import SwiftUI

struct PhoneView: View {
    @StateObject private var tunnel = TunnelController()
    @State private var profile = Vault.load()
    @State private var pings: [String: Int] = [:]
    @State private var pinging = Set<String>()
    @State private var infoId: String?
    @State private var showAdd = false
    @State private var draft = ""
    @State private var importing = false
    @State private var notice = ""
    @State private var connectedAt: Date?
    @State private var now = Date()

    private var current: ServerNode? { profile.current }
    private var line: String { notice.isEmpty ? tunnel.message : notice }

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: 0) {
                stage
                    .frame(height: max(300, geo.size.height * 0.46))
                list
            }
            .background(Color.black)
        }
        .sheet(isPresented: $showAdd) { addSheet }
        .onAppear { openPermissionIfNeeded() }
        .onChange(of: tunnel.checked) { _, _ in
            openPermissionIfNeeded()
        }
        .onChange(of: tunnel.status) { _, status in
            if status == .connected {
                if connectedAt == nil { connectedAt = Date() }
            } else if status == .disconnected || status == .invalid {
                connectedAt = nil
            }
        }
        .task(id: tunnel.status == .connected) {
            guard tunnel.status == .connected else { return }
            while !Task.isCancelled {
                now = Date()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func openPermissionIfNeeded() {
        guard !tunnel.installed else { return }
        PermissionWindow.present { saved in
            Task { @MainActor in
                await tunnel.accept(saved)
                guard tunnel.installed else { return }
                guard let current else {
                    tunnel.message = "Разрешение есть. Добавьте подписку и нажмите кнопку питания."
                    return
                }
                await tunnel.connect(current)
            }
        }
    }

    private var stage: some View {
        ZStack {
            Color(red: 0.004, green: 0.004, blue: 0.004)
            StarField(speed: speed)
            VStack {
                Spacer()
                dock
                    .padding(.bottom, 22)
            }
        }
        .clipped()
    }

    private var dock: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                FlagMark(name: current?.name ?? "")
                Text(current.map { Place.label($0.name) } ?? "Нет сервера")
                    .font(.system(size: 14, weight: .semibold))
                    .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 52)
            .background(Color(red: 0.07, green: 0.07, blue: 0.078).opacity(0.94))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.white.opacity(0.1), lineWidth: 1))
            .shadow(color: .black.opacity(0.45), radius: 18, y: 10)

            Text("TUN")
                .font(.system(size: 12, weight: .semibold))
                .tracking(1.6)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 34)
                .background(Color(white: 0.227))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(4)
                .background(Color(red: 0.07, green: 0.07, blue: 0.078).opacity(0.94))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.white.opacity(0.1), lineWidth: 1))
                .shadow(color: .black.opacity(0.45), radius: 18, y: 10)

            Button {
                notice = ""
                if !tunnel.installed {
                    openPermissionIfNeeded()
                    return
                }
                guard let current else { return }
                Task {
                    if tunnel.live { tunnel.disconnect() }
                    else { await tunnel.connect(current) }
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "power")
                        .font(.system(size: 15, weight: .semibold))
                    Text(label)
                        .font(.system(size: 14, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(tunnel.live ? Color(white: 0.173) : Color.white)
                .foregroundStyle(tunnel.live ? Color.white : Color(white: 0.067))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.white.opacity(0.1), lineWidth: 1))
                .shadow(color: .black.opacity(0.45), radius: 18, y: 10)
            }
            .buttonStyle(.plain)
            .disabled(tunnel.busy || (tunnel.installed && current == nil))

            if !line.isEmpty {
                Text(line)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.62))
                    .padding(.horizontal, 6)
            }
            if tunnel.status == .connected, let connectedAt {
                Text(clock(since: connectedAt))
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Color.white.opacity(0.62))
                    .padding(.horizontal, 6)
            }
        }
        .frame(width: 280)
    }

    private var list: some View {
        VStack(spacing: 0) {
            HStack {
                Text("astral")
                    .font(.system(size: 15, weight: .medium))
                    .tracking(2.7)
                    .textCase(.lowercase)
                Spacer()
                iconButton("wave.3.right") { Task { await ping(profile.servers) } }
                    .disabled(profile.servers.isEmpty || !pinging.isEmpty)
                iconButton("plus") {
                    draft = ""
                    showAdd = true
                }
            }
            .foregroundStyle(Color.white.opacity(0.9))
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 8)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if profile.subscriptions.isEmpty {
                        Text("Добавьте подписку по ссылке\nили вставьте vless://")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.white.opacity(0.42))
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 48)
                            .padding(.horizontal, 18)
                    }
                    ForEach(profile.subscriptions) { sub in
                        subscription(sub)
                        ForEach(profile.servers.filter { $0.subId == sub.id }) { server in
                            serverRow(server)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 28)
            }
            .scrollIndicators(.hidden)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(white: 0.055))
        .overlay(alignment: .top) { Rectangle().fill(Color.white.opacity(0.06)).frame(height: 1) }
    }

    private func subscription(_ sub: Subscription) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Text(sub.name)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.42))
                    .lineLimit(1)
                Spacer(minLength: 8)
                textButton("пинг") { Task { await ping(profile.servers.filter { $0.subId == sub.id }) } }
                textButton("обновить") { Task { await refresh(sub) } }
                    .disabled(sub.url.isEmpty || importing)
                textButton("убрать") { remove(sub) }
                textButton("инфо", on: infoId == sub.id) { infoId = infoId == sub.id ? nil : sub.id }
            }
            .frame(height: 28)
            .padding(.horizontal, 8)
            if infoId == sub.id {
                VStack(alignment: .leading, spacing: 8) {
                    if !sub.announce.isEmpty {
                        Text(sub.announce)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.white.opacity(0.94))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !When.day(sub.expire).isEmpty || sub.updated > 0 {
                        VStack(alignment: .leading, spacing: 4) {
                            if !When.day(sub.expire).isEmpty {
                                Text(When.day(sub.expire))
                            }
                            Text("обновлено \(When.updated(sub.updated))")
                        }
                        .font(.system(size: 12))
                        .foregroundStyle(Color.white.opacity(0.72))
                        .padding(.top, sub.announce.isEmpty ? 0 : 8)
                        .overlay(alignment: .top) {
                            if !sub.announce.isEmpty {
                                Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1)
                            }
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(white: 0.173))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.white.opacity(0.22), lineWidth: 1))
                .shadow(color: .black.opacity(0.55), radius: 18, y: 10)
                .padding(.horizontal, 8)
                .padding(.bottom, 8)
            }
        }
        .padding(.top, 8)
    }

    private func serverRow(_ server: ServerNode) -> some View {
        Button {
            let changed = profile.selected != server.id
            profile.selected = server.id
            Vault.save(profile)
            if changed && tunnel.live {
                notice = ""
                Task { await tunnel.connect(server) }
            }
        } label: {
            HStack(spacing: 12) {
                FlagMark(name: server.name)
                Text(Place.label(server.name))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Spacer(minLength: 8)
                pingMark(server.id)
            }
            .padding(.horizontal, 10)
            .frame(height: 44)
            .background(server.id == current?.id ? Color(white: 0.204) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func pingMark(_ id: String) -> some View {
        let value = pings[id]
        let busy = pinging.contains(id)
        return HStack(spacing: 8) {
            if let value, value > 0 {
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.16))
                    Capsule().fill(Color.white)
                        .frame(width: 28 * max(0.12, 1 - min(Double(value), 400) / 400))
                }
                .frame(width: 28, height: 2)
            }
            Text(pingText(value, busy: busy))
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(busy || value == nil ? Color.white.opacity(0.35) : Color.white.opacity(0.9))
        }
    }

    private func iconButton(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .medium))
                .frame(width: 32, height: 32)
                .foregroundStyle(Color.white.opacity(0.78))
        }
        .buttonStyle(.plain)
    }

    private func textButton(_ title: String, on: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12))
                .foregroundStyle(on ? Color.white : Color.white.opacity(0.45))
        }
        .buttonStyle(.plain)
    }

    private var addSheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Подписка")
                    .font(.system(size: 16, weight: .semibold))
                Spacer()
                Button("Закрыть") { showAdd = false }
                    .font(.system(size: 13))
                    .foregroundStyle(Color.white.opacity(0.75))
            }
            Text("Ссылка подписки или строки vless://")
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.5))
            TextEditor(text: $draft)
                .scrollContentBackground(.hidden)
                .padding(8)
                .frame(minHeight: 160)
                .background(Color.white.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            HStack {
                Button("Вставить") { draft = UIPasteboard.general.string ?? draft }
                    .font(.system(size: 13))
                    .foregroundStyle(Color.white.opacity(0.75))
                Spacer()
                Button(importing ? "Загрузка" : "Добавить") { Task { await add() } }
                    .font(.system(size: 13, weight: .semibold))
                    .padding(.horizontal, 14)
                    .frame(height: 36)
                    .background(Color.white)
                    .foregroundStyle(Color(white: 0.067))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || importing)
            }
            Spacer(minLength: 0)
        }
        .padding(18)
        .background(Color(white: 0.11))
        .foregroundStyle(.white)
        .presentationDetents([.medium, .large])
        .presentationBackground(Color(white: 0.11))
        .preferredColorScheme(.dark)
    }

    private var label: String {
        switch tunnel.status {
        case .connecting, .reasserting: return "Подключение"
        case .connected: return "Выключить"
        default: return "Включить"
        }
    }

    private var speed: Double {
        switch tunnel.status {
        case .connecting, .reasserting: return 78
        case .connected: return 28
        default: return 12
        }
    }

    private func pingText(_ value: Int?, busy: Bool) -> String {
        if busy { return "···" }
        guard let value else { return "—" }
        if value < 0 { return "нет" }
        return "\(value) мс"
    }

    private func clock(since date: Date) -> String {
        let seconds = max(0, Int(now.timeIntervalSince(date)))
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    private func add() async {
        importing = true
        defer { importing = false }
        do {
            profile = try await Importer.load(source: draft, into: profile)
            Vault.save(profile)
            draft = ""
            showAdd = false
            notice = ""
        } catch {
            notice = error.localizedDescription
        }
    }

    private func refresh(_ sub: Subscription) async {
        guard !sub.url.isEmpty else { return }
        importing = true
        defer { importing = false }
        do {
            profile = try await Importer.load(source: sub.url, into: profile)
            Vault.save(profile)
            notice = ""
        } catch {
            notice = error.localizedDescription
        }
    }

    private func remove(_ sub: Subscription) {
        if tunnel.live { tunnel.disconnect() }
        profile.subscriptions.removeAll { $0.id == sub.id }
        profile.servers.removeAll { $0.subId == sub.id }
        if !profile.servers.contains(where: { $0.id == profile.selected }) {
            profile.selected = profile.servers.first?.id ?? ""
        }
        if infoId == sub.id { infoId = nil }
        Vault.save(profile)
    }

    private func ping(_ servers: [ServerNode]) async {
        let ids = Set(servers.map(\.id))
        pinging.formUnion(ids)
        await withTaskGroup(of: (String, Int).self) { group in
            for server in servers {
                let endpoint = RunConfig.endpoint(of: server)
                group.addTask {
                    let ms = await Probe.tcp(host: endpoint.host, port: endpoint.port)
                    return (server.id, ms)
                }
            }
            for await item in group {
                pings[item.0] = item.1
                pinging.remove(item.0)
            }
        }
    }
}

private struct StarField: View {
    var speed: Double

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
            Canvas { context, size in
                let time = timeline.date.timeIntervalSinceReferenceDate
                for index in 0..<160 {
                    let seed = Double((index * 97) % 1000) / 1000
                    let drift = Double((index * 53) % 1000) / 1000
                    let x = CGFloat((seed * 1.9 + drift * 0.15).truncatingRemainder(dividingBy: 1)) * size.width
                    let pace = speed * (0.25 + seed * 0.9)
                    let travel = (seed * size.height + time * pace).truncatingRemainder(dividingBy: size.height + 24)
                    let y = CGFloat(travel)
                    let radius: CGFloat = index % 19 == 0 ? 2.2 : (index % 6 == 0 ? 1.45 : 0.9)
                    let glow = CGRect(x: x - radius * 2.2, y: y - radius * 2.2, width: radius * 6.4, height: radius * 6.4)
                    let core = CGRect(x: x, y: y, width: radius * 2, height: radius * 2)
                    context.fill(Path(ellipseIn: glow), with: .color(.white.opacity(index % 3 == 0 ? 0.16 : 0.07)))
                    context.fill(Path(ellipseIn: core), with: .color(.white.opacity(index % 4 == 0 ? 0.95 : 0.55)))
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
