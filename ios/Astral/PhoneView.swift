import SwiftUI
import UIKit

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
        ZStack {
            Color(red: 0.004, green: 0.004, blue: 0.004).ignoresSafeArea()
            VStack(spacing: 0) {
                stage
                list
            }
        }
        .sheet(isPresented: $showAdd) { addSheet }
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

    private var stage: some View {
        ZStack(alignment: .bottom) {
            StarField(speed: speed)
            VStack(spacing: 14) {
                HStack {
                    Text("astral")
                        .font(.system(size: 15, weight: .medium))
                        .tracking(3)
                        .textCase(.lowercase)
                    Spacer()
                    Button {
                        draft = ""
                        showAdd = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 16, weight: .semibold))
                            .frame(width: 36, height: 36)
                    }
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                Spacer()
                dock
            }
        }
        .frame(minHeight: 300)
    }

    private var dock: some View {
        VStack(spacing: 10) {
            Text(current?.name ?? "Нет сервера")
                .font(.system(size: 15, weight: .medium))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 8) {
                Text("TUN")
                    .font(.system(size: 12, weight: .semibold))
                    .tracking(1.4)
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
                    .background(Color.white.opacity(0.14))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                Button {
                    guard let current else { return }
                    notice = ""
                    Task {
                        if tunnel.live { tunnel.disconnect() }
                        else { await tunnel.connect(current) }
                    }
                } label: {
                    Text(label)
                        .font(.system(size: 16, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .background(tunnel.live ? Color.white.opacity(0.16) : Color.white)
                        .foregroundStyle(tunnel.live ? Color.white : Color.black)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
                .disabled(current == nil || tunnel.busy)
            }
            if tunnel.status == .connected, let connectedAt {
                Text(clock(since: connectedAt))
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.65))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !line.isEmpty {
                Text(line)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.75))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 22))
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if profile.subscriptions.isEmpty {
                    Text("Добавьте подписку")
                        .font(.system(size: 14))
                        .foregroundStyle(.white.opacity(0.45))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8)
                        .padding(.top, 8)
                }
                ForEach(profile.subscriptions) { sub in
                    subscription(sub)
                    ForEach(profile.servers.filter { $0.subId == sub.id }) { server in
                        serverRow(server)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 24)
        }
        .background(Color.black)
    }

    private func subscription(_ sub: Subscription) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(sub.name)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
            HStack(spacing: 14) {
                textButton("пинг") { Task { await ping(profile.servers.filter { $0.subId == sub.id }) } }
                textButton("обновить") { Task { await refresh(sub) } }
                    .disabled(sub.url.isEmpty || importing)
                textButton("убрать") { remove(sub) }
                textButton("инфо", on: infoId == sub.id) { infoId = infoId == sub.id ? nil : sub.id }
            }
            .font(.system(size: 13))
            if infoId == sub.id {
                VStack(alignment: .leading, spacing: 6) {
                    if !sub.announce.isEmpty {
                        Text(sub.announce)
                            .font(.system(size: 13))
                            .foregroundStyle(.white)
                    }
                    if !When.day(sub.expire).isEmpty {
                        Text(When.day(sub.expire))
                            .font(.system(size: 13))
                    }
                    Text("обновлено \(When.updated(sub.updated))")
                        .font(.system(size: 12))
                        .foregroundStyle(.white.opacity(0.55))
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(white: 0.17))
                .clipShape(RoundedRectangle(cornerRadius: 14))
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 12)
        .foregroundStyle(.white)
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
            HStack(spacing: 10) {
                Text(server.name)
                    .lineLimit(1)
                    .foregroundStyle(.white)
                Spacer(minLength: 8)
                pingMark(server.id)
            }
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(server.id == current?.id ? Color.white.opacity(0.16) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    private func pingMark(_ id: String) -> some View {
        let value = pings[id]
        return HStack(spacing: 6) {
            if let value, value > 0 {
                Capsule()
                    .fill(Color.white.opacity(0.85))
                    .frame(width: 28 * max(0.15, 1 - min(Double(value), 400) / 400), height: 3)
            }
            Text(pingText(value, busy: pinging.contains(id)))
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(.white.opacity(0.7))
        }
    }

    private func textButton(_ title: String, on: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .foregroundStyle(on ? Color.white : Color.white.opacity(0.72))
        }
        .buttonStyle(.plain)
    }

    private var addSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                Text("Ссылка подписки или строки vless://")
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.6))
                TextEditor(text: $draft)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .frame(minHeight: 180)
                    .background(Color.white.opacity(0.06))
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                HStack {
                    Button("Вставить") { draft = UIPasteboard.general.string ?? draft }
                    Spacer()
                    Button(importing ? "Загрузка" : "Добавить") { Task { await add() } }
                        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || importing)
                }
                .font(.system(size: 16, weight: .semibold))
                Spacer()
            }
            .padding(16)
            .background(Color.black)
            .foregroundStyle(.white)
            .navigationTitle("Подписка")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { showAdd = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
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
        case .connecting, .reasserting: return 90
        case .connected: return 34
        default: return 14
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
                for index in 0..<140 {
                    let seed = Double((index * 97) % 1000) / 1000
                    let x = CGFloat((seed * 1.7).truncatingRemainder(dividingBy: 1)) * size.width
                    let pace = speed * (0.35 + seed)
                    let y = CGFloat((seed * size.height + time * pace).truncatingRemainder(dividingBy: size.height + 8))
                    let radius: CGFloat = index % 17 == 0 ? 2.4 : (index % 5 == 0 ? 1.6 : 1.05)
                    let rect = CGRect(x: x, y: y, width: radius * 2, height: radius * 2)
                    context.fill(Path(ellipseIn: rect), with: .color(.white.opacity(index % 4 == 0 ? 0.9 : 0.38)))
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
