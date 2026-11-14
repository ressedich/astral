import SwiftUI

struct PhoneView: View {
    @StateObject private var tunnel = TunnelController()
    @State private var servers: [ServerRecord] = []
    @State private var selected = ""
    @State private var draft = ""

    private var current: ServerRecord? { servers.first { $0.id == selected } ?? servers.first }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            StarField()
            VStack(spacing: 0) {
                header
                list
                controls
            }
        }
        .onAppear(perform: restore)
    }

    private var header: some View {
        HStack {
            Text("astral")
                .font(.custom("Avenir Next", size: 15))
                .tracking(3)
                .textCase(.lowercase)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .foregroundStyle(.white)
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("СЕРВЕРЫ")
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.4))
                    .padding(.horizontal, 8)
                ForEach(servers) { server in
                    Button {
                        selected = server.id
                        persist()
                    } label: {
                        HStack {
                            Text(server.name)
                                .lineLimit(1)
                            Spacer()
                        }
                        .padding(.horizontal, 12)
                        .frame(height: 44)
                        .background(server.id == current?.id ? Color(white: 0.2) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                }
                HStack(spacing: 8) {
                    TextField("имя сервера", text: $draft)
                        .textInputAutocapitalization(.never)
                        .padding(.horizontal, 12)
                        .frame(height: 40)
                        .background(Color(white: 0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    Button("добавить") { add() }
                        .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .padding(12)
        }
    }

    private var controls: some View {
        VStack(spacing: 10) {
            Text("TUN")
                .font(.system(size: 12, weight: .semibold))
                .tracking(2)
                .frame(maxWidth: .infinity)
                .frame(height: 34)
                .background(Color(white: 0.16))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            Button {
                guard let current else { return }
                Task { await tunnel.toggle(server: current) }
            } label: {
                Text(label)
                    .font(.system(size: 16, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(tunnel.live ? Color(white: 0.18) : Color.white)
                    .foregroundStyle(tunnel.live ? Color.white : Color.black)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
            .disabled(current == nil || tunnel.busy)
            if !tunnel.message.isEmpty {
                Text(tunnel.message)
                    .font(.system(size: 12))
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
            }
        }
        .padding(16)
    }

    private var label: String {
        switch tunnel.status {
        case .connecting: return "Подключение"
        case .connected: return "Выключить"
        default: return "Включить"
        }
    }

    private func restore() {
        let stored = ServerStore.load()
        servers = stored.servers
        selected = stored.selected
    }

    private func add() {
        let name = draft.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        let server = ServerRecord(id: UUID().uuidString, name: name, host: name)
        servers.append(server)
        selected = server.id
        draft = ""
        persist()
    }

    private func persist() {
        ServerStore.save(servers: servers, selected: selected)
    }
}

private struct StarField: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { timeline in
            Canvas { context, size in
                let time = timeline.date.timeIntervalSinceReferenceDate
                for index in 0..<90 {
                    let seed = Double(index * 97 % 1000) / 1000
                    let x = CGFloat((seed * 1.7).truncatingRemainder(dividingBy: 1)) * size.width
                    let speed = 12 + seed * 40
                    let y = CGFloat((seed * size.height + time * speed).truncatingRemainder(dividingBy: size.height))
                    let radius: CGFloat = index % 11 == 0 ? 2.2 : 1.1
                    let rect = CGRect(x: x, y: y, width: radius * 2, height: radius * 2)
                    context.fill(Path(ellipseIn: rect), with: .color(.white.opacity(index % 4 == 0 ? 0.9 : 0.45)))
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
