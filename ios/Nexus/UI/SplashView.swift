import SwiftUI

struct SplashView: View {
    @State private var opacity: Double = 0

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            VStack(spacing: 8) {
                Image(systemName: "tray.2.fill")
                    .font(.system(size: 56, weight: .light))
                    .foregroundColor(.accentColor)
                Text("Nexus")
                    .font(.system(size: 48, weight: .bold, design: .default))
                    .foregroundColor(.primary)
                Text("Private email, beautifully simple.")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            .opacity(opacity)
            .onAppear {
                withAnimation(.easeIn(duration: 0.35)) { opacity = 1 }
            }
        }
    }
}
