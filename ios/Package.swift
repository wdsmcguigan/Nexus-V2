// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "Nexus",
    platforms: [
        .iOS(.v15)
    ],
    products: [
        .library(name: "Nexus", targets: ["Nexus"])
    ],
    dependencies: [
        // SQLite ORM with SQLCipher support — same encrypted format as desktop (key="nexus")
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.0.0"),
        // XChaCha20-Poly1305 via _CryptoExtras (24-byte nonce, matches Rust chacha20poly1305 crate)
        .package(url: "https://github.com/apple/swift-crypto.git", from: "3.0.0"),
    ],
    targets: [
        .target(
            name: "Nexus",
            dependencies: [
                .product(name: "GRDBSQLCipher", package: "GRDB.swift"),
                .product(name: "Crypto", package: "swift-crypto"),
                .product(name: "_CryptoExtras", package: "swift-crypto"),
            ],
            path: "Nexus",
            resources: [
                .process("Data/Schema.sql")
            ]
        ),
        .testTarget(
            name: "NexusTests",
            dependencies: ["Nexus"],
            path: "NexusTests"
        )
    ]
)
