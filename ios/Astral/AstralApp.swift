import SwiftUI

@main
struct AstralApp: App {
    var body: some Scene {
        WindowGroup {
            PhoneView()
                .preferredColorScheme(.dark)
        }
    }
}
