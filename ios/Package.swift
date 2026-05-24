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
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.0.0"),
    ],
    targets: [
        .target(
            name: "Nexus",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
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
