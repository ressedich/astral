import SwiftUI

enum Place {
    static func code(of name: String) -> String {
        let scalars = Array(name.unicodeScalars)
        if scalars.count >= 2 {
            for index in 0..<(scalars.count - 1) {
                let first = scalars[index].value
                let second = scalars[index + 1].value
                if (0x1F1E6...0x1F1FF).contains(first), (0x1F1E6...0x1F1FF).contains(second) {
                    return String(UnicodeScalar(first - 127397)!) + String(UnicodeScalar(second - 127397)!)
                }
            }
        }
        if let match = name.range(of: #"[\(\[]([A-Za-z]{2})[\)\]]"#, options: .regularExpression) {
            let token = String(name[match]).filter(\.isLetter)
            if token.count == 2 { return token.uppercased() }
        }
        let lower = name.lowercased()
        for (word, code) in words.sorted(by: { $0.0.count > $1.0.count }) where lower.contains(word) {
            return code
        }
        return ""
    }

    static func label(_ name: String) -> String {
        var cleaned = ""
        var scalars = Array(name.unicodeScalars)
        var index = 0
        while index < scalars.count {
            if index + 1 < scalars.count,
               (0x1F1E6...0x1F1FF).contains(scalars[index].value),
               (0x1F1E6...0x1F1FF).contains(scalars[index + 1].value) {
                index += 2
                continue
            }
            cleaned.unicodeScalars.append(scalars[index])
            index += 1
        }
        let plain = cleaned.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return plain.split(separator: "|").first.map { String($0).trimmingCharacters(in: .whitespaces) } ?? plain
    }

    private static let words: [(String, String)] = [
        ("united kingdom", "GB"), ("great britain", "GB"), ("hong kong", "HK"), ("united states", "US"),
        ("netherlands", "NL"), ("amsterdam", "NL"), ("нидерланд", "NL"), ("голлан", "NL"),
        ("germany", "DE"), ("frankfurt", "DE"), ("berlin", "DE"), ("герман", "DE"),
        ("poland", "PL"), ("warsaw", "PL"), ("польш", "PL"),
        ("sweden", "SE"), ("stockholm", "SE"), ("швец", "SE"),
        ("finland", "FI"), ("helsinki", "FI"), ("финлянд", "FI"),
        ("france", "FR"), ("paris", "FR"), ("франц", "FR"),
        ("japan", "JP"), ("tokyo", "JP"), ("япон", "JP"),
        ("singapore", "SG"), ("сингапур", "SG"), ("гонконг", "HK"),
        ("korea", "KR"), ("seoul", "KR"), ("корея", "KR"),
        ("turkey", "TR"), ("istanbul", "TR"), ("турц", "TR"),
        ("canada", "CA"), ("канад", "CA"), ("australia", "AU"), ("австрал", "AU"),
        ("switzerland", "CH"), ("zurich", "CH"), ("швейцар", "CH"),
        ("austria", "AT"), ("vienna", "AT"), ("австри", "AT"),
        ("czech", "CZ"), ("prague", "CZ"), ("чех", "CZ"),
        ("romania", "RO"), ("румын", "RO"), ("bulgaria", "BG"), ("болгар", "BG"),
        ("ukraine", "UA"), ("kyiv", "UA"), ("kiev", "UA"), ("украин", "UA"),
        ("kazakhstan", "KZ"), ("казах", "KZ"),
        ("latvia", "LV"), ("латви", "LV"), ("lithuania", "LT"), ("литва", "LT"),
        ("estonia", "EE"), ("эстон", "EE"),
        ("spain", "ES"), ("испан", "ES"), ("italy", "IT"), ("итал", "IT"),
        ("portugal", "PT"), ("португал", "PT"),
        ("brazil", "BR"), ("бразил", "BR"), ("india", "IN"), ("индия", "IN"),
        ("israel", "IL"), ("израил", "IL"),
        ("norway", "NO"), ("норвег", "NO"), ("denmark", "DK"), ("дания", "DK"), ("дани", "DK"),
        ("ireland", "IE"), ("ирланд", "IE"), ("belgium", "BE"), ("бельг", "BE"),
        ("hungary", "HU"), ("венгр", "HU"), ("serbia", "RS"), ("серб", "RS"),
        ("moldova", "MD"), ("молдов", "MD"), ("georgia", "GE"), ("грузи", "GE"),
        ("armenia", "AM"), ("армен", "AM"), ("taiwan", "TW"), ("тайван", "TW"),
        ("thailand", "TH"), ("таиланд", "TH"), ("vietnam", "VN"), ("вьетнам", "VN"),
        ("indonesia", "ID"), ("индонез", "ID"), ("malaysia", "MY"), ("малайз", "MY"),
        ("mexico", "MX"), ("мексик", "MX"), ("argentina", "AR"), ("аргентин", "AR"),
        ("emirates", "AE"), ("dubai", "AE"), ("дубай", "AE"),
        ("russia", "RU"), ("moscow", "RU"), ("росси", "RU"), ("москва", "RU"),
        ("usa", "US"), ("сша", "US"), ("америк", "US"),
        ("london", "GB"), ("britain", "GB"), ("england", "GB"), ("англия", "GB"), ("великобрит", "GB"),
    ]
}

struct FlagMark: View {
    var name: String

    var body: some View {
        let code = Place.code(of: name)
        Canvas { context, size in
            context.scaleBy(x: size.width / 60, y: size.height / 40)
            if code.isEmpty {
                context.fill(Path(CGRect(x: 0, y: 0, width: 60, height: 40)), with: .color(Color(white: 0.16)))
                return
            }
            paint(code, &context)
        }
        .frame(width: 26, height: 18)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).stroke(Color.white.opacity(0.16), lineWidth: 1))
    }
}

private func paint(_ code: String, _ context: inout GraphicsContext) {
    switch code {
    case "US":
        for index in 0..<13 {
            fill(&context, 0, CGFloat(index) * 40 / 13, 60, 40 / 13 + 0.3, index % 2 == 0 ? "#bf0a30" : "#fff")
        }
        fill(&context, 0, 0, 26, 21, "#002868")
    case "GB":
        jack(&context)
    case "AU":
        fill(&context, 0, 0, 60, 40, "#012169")
        context.drawLayer { layer in
            layer.scaleBy(x: 0.5, y: 0.5)
            jack(&layer)
        }
        fill(&context, 42, 26, 4, 4, "#fff", circle: true)
        fill(&context, 48.4, 12.4, 3.2, 3.2, "#fff", circle: true)
    case "CH", "GE":
        let bg = code == "CH" ? "#d52b1e" : "#fff"
        let cross = code == "CH" ? "#fff" : "#ff0000"
        fill(&context, 0, 0, 60, 40, bg)
        fill(&context, 26, 8, 8, 24, cross)
        fill(&context, 18, 16, 24, 8, cross)
    case "SE": nordic(&context, "#006aa7", "#fecc00", nil)
    case "FI": nordic(&context, "#fff", "#003580", nil)
    case "DK": nordic(&context, "#c60c30", "#fff", nil)
    case "NO": nordic(&context, "#ba0c2f", "#fff", "#00205b")
    case "JP":
        fill(&context, 0, 0, 60, 40, "#fff")
        fill(&context, 22, 12, 16, 16, "#bc002d", circle: true)
    case "TR":
        fill(&context, 0, 0, 60, 40, "#e30a17")
        fill(&context, 20, 12, 16, 16, "#fff", circle: true)
        fill(&context, 24.5, 13.5, 13, 13, "#e30a17", circle: true)
    default:
        guard let paint = paints[code] else {
            fill(&context, 0, 0, 60, 40, "#2a2a2a")
            return
        }
        if let colors = paint.h { bars(&context, colors, vertical: false) }
        if let colors = paint.v { bars(&context, colors, vertical: true) }
        if let canton = paint.canton { fill(&context, 0, 0, 24, 16, canton) }
        if let disc = paint.disc { fill(&context, 22, 12, 16, 16, disc, circle: true) }
    }
}

private struct Paint {
    var h: [String]?
    var v: [String]?
    var canton: String?
    var disc: String?
}

private let paints: [String: Paint] = [
    "DE": .init(h: ["#000", "#dd0000", "#ffce00"]),
    "NL": .init(h: ["#ae1c28", "#fff", "#21468b"]),
    "PL": .init(h: ["#fff", "#dc143c"]),
    "RU": .init(h: ["#fff", "#0039a6", "#d52b1e"]),
    "UA": .init(h: ["#005bbb", "#ffd500"]),
    "AT": .init(h: ["#ed2939", "#fff", "#ed2939"]),
    "EE": .init(h: ["#0072ce", "#000", "#fff"]),
    "LV": .init(h: ["#9e3039", "#fff", "#9e3039"]),
    "LT": .init(h: ["#fdb913", "#006a44", "#c1272d"]),
    "AM": .init(h: ["#d90012", "#0033a0", "#f2a800"]),
    "BG": .init(h: ["#fff", "#00966e", "#d62612"]),
    "HU": .init(h: ["#ce2939", "#fff", "#477050"]),
    "ES": .init(h: ["#aa151b", "#f1bf00", "#aa151b"]),
    "TH": .init(h: ["#a51931", "#f4f5f8", "#2d2a4a", "#f4f5f8", "#a51931"]),
    "ID": .init(h: ["#ce1126", "#fff"]),
    "AR": .init(h: ["#74acdf", "#fff", "#74acdf"]),
    "SG": .init(h: ["#ef3340", "#fff"]),
    "HK": .init(h: ["#de2910"]),
    "KZ": .init(h: ["#00afca"]),
    "RS": .init(h: ["#c6363c", "#0c4076", "#fff"]),
    "IL": .init(h: ["#fff", "#0038b8", "#fff"]),
    "IN": .init(h: ["#ff9933", "#fff", "#138808"]),
    "CZ": .init(h: ["#fff", "#d7141a"], canton: "#11457e"),
    "TW": .init(h: ["#fe0000"], canton: "#000095"),
    "FR": .init(v: ["#0055a4", "#fff", "#ef4135"]),
    "IT": .init(v: ["#009246", "#fff", "#ce2b37"]),
    "BE": .init(v: ["#000", "#fdda24", "#ef3340"]),
    "IE": .init(v: ["#169b62", "#fff", "#ff883e"]),
    "RO": .init(v: ["#002b7f", "#fcd116", "#ce1126"]),
    "AE": .init(v: ["#00732f", "#fff", "#000"]),
    "CA": .init(v: ["#ff0000", "#fff", "#ff0000"]),
    "PT": .init(v: ["#006600", "#ff0000"]),
    "MX": .init(v: ["#006847", "#fff", "#ce1126"]),
    "MD": .init(v: ["#003da5", "#ffd200", "#c8102e"]),
    "BR": .init(h: ["#009c3b"], disc: "#ffdf00"),
    "VN": .init(h: ["#da251d"], disc: "#ff0"),
    "KR": .init(h: ["#fff"], disc: "#cd2e3a"),
]

private func bars(_ context: inout GraphicsContext, _ colors: [String], vertical: Bool) {
    let size = CGFloat(colors.count)
    for (index, color) in colors.enumerated() {
        let step = index
        if vertical {
            fill(&context, (60 / size) * CGFloat(step), 0, 60 / size + 0.4, 40, color)
        } else {
            fill(&context, 0, (40 / size) * CGFloat(step), 60, 40 / size + 0.4, color)
        }
    }
}

private func nordic(_ context: inout GraphicsContext, _ bg: String, _ cross: String, _ outline: String?) {
    fill(&context, 0, 0, 60, 40, bg)
    if let outline {
        fill(&context, 14, 0, 14, 40, outline)
        fill(&context, 0, 12, 60, 14, outline)
    }
    fill(&context, 17, 0, 8, 40, cross)
    fill(&context, 0, 15, 60, 8, cross)
}

private func jack(_ context: inout GraphicsContext) {
    fill(&context, 0, 0, 60, 40, "#012169")
    var white = Path()
    white.move(to: CGPoint(x: 0, y: 0))
    white.addLine(to: CGPoint(x: 60, y: 40))
    white.move(to: CGPoint(x: 60, y: 0))
    white.addLine(to: CGPoint(x: 0, y: 40))
    context.stroke(white, with: .color(Color.white), lineWidth: 7)
    var red = Path()
    red.move(to: CGPoint(x: 0, y: 0))
    red.addLine(to: CGPoint(x: 60, y: 40))
    red.move(to: CGPoint(x: 60, y: 0))
    red.addLine(to: CGPoint(x: 0, y: 40))
    context.stroke(red, with: .color(Color(hex: "#C8102E")), lineWidth: 2.4)
    fill(&context, 26, 0, 8, 40, "#fff")
    fill(&context, 0, 16, 60, 8, "#fff")
    fill(&context, 28, 0, 4, 40, "#C8102E")
    fill(&context, 0, 18, 60, 4, "#C8102E")
}

private func fill(_ context: inout GraphicsContext, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ hex: String, circle: Bool = false) {
    let rect = CGRect(x: x, y: y, width: w, height: h)
    let path = circle ? Path(ellipseIn: rect) : Path(rect)
    context.fill(path, with: .color(Color(hex: hex)))
}

private extension Color {
    init(hex: String) {
        let text = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var value: UInt64 = 0
        Scanner(string: text).scanHexInt64(&value)
        if text.count == 3 {
            let r = Double((value >> 8) & 0xF) / 15
            let g = Double((value >> 4) & 0xF) / 15
            let b = Double(value & 0xF) / 15
            self.init(red: r, green: g, blue: b)
            return
        }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
