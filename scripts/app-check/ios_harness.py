"""
Write a copy of the iOS project with a UI-test target in it, for scripts/app-check/ios.sh.

The app's own project has no test target, and the Claude Code simulator tools need
`xcode-select` pointed at a full Xcode, which takes the owner's password. A UI test
needs neither: `xcodebuild test` drives the simulator itself, with DEVELOPER_DIR set
for the one command. So the app's project is copied into ios/build-uitest/, which is
gitignored, with one target added that runs scripts/app-check/HarnessUITests.swift.
The real project is never touched, and the copy is rewritten on every run.

`projectDirPath = ..` makes the copy resolve every path from ios/, exactly as the
original does from where it sits.

    python3 scripts/app-check/ios_harness.py
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "ios" / "SurfriderDataCards.xcodeproj" / "project.pbxproj"
OUT = ROOT / "ios" / "build-uitest" / "Harness.xcodeproj"
# A scheme names its project from the project directory, which is ios/, not from
# where the .xcodeproj sits.
CONTAINER = "build-uitest/Harness.xcodeproj"

APP_TARGET = "AA0000000000000000000004"
PROJECT = "AA0000000000000000000001"
ID = {
    k: "BB0000000000000000000" + v
    for k, v in {
        "file": "001",
        "product": "002",
        "build": "003",
        "sources": "004",
        "frameworks": "005",
        "proxy": "006",
        "dep": "007",
        "target": "008",
        "configs": "009",
        "debug": "00A",
        "release": "00B",
        "group": "00C",
    }.items()
}


def add(text: str, section: str, body: str) -> str:
    marker = f"/* End {section} section */"
    if marker not in text:
        raise SystemExit(f"{SOURCE} has no {section} section; the project has changed shape")
    return text.replace(marker, body + marker, 1)


def config(key: str, name: str) -> str:
    return (
        f"\t\t{ID[key]} /* {name} */ = {{\n"
        "\t\t\tisa = XCBuildConfiguration;\n"
        "\t\t\tbuildSettings = {\n"
        "\t\t\t\tCODE_SIGN_STYLE = Automatic;\n"
        "\t\t\t\tGENERATE_INFOPLIST_FILE = YES;\n"
        '\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = "$(APP_BUNDLE_ID).HarnessUITests";\n'
        '\t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";\n'
        "\t\t\t\tSWIFT_VERSION = 5.0;\n"
        "\t\t\t\tTARGETED_DEVICE_FAMILY = 1;\n"
        '\t\t\t\tTEST_TARGET_NAME = "Data Cards";\n'
        "\t\t\t};\n"
        f"\t\t\tname = {name};\n"
        "\t\t};\n"
    )


def harness(text: str) -> str:
    text = add(
        text,
        "PBXBuildFile",
        f"\t\t{ID['build']} /* HarnessUITests.swift in Sources */ = {{isa = PBXBuildFile; "
        f"fileRef = {ID['file']} /* HarnessUITests.swift */; }};\n",
    )
    text = add(
        text,
        "PBXFileReference",
        f"\t\t{ID['file']} /* HarnessUITests.swift */ = {{isa = PBXFileReference; "
        "lastKnownFileType = sourcecode.swift; "
        'path = "../scripts/app-check/HarnessUITests.swift"; sourceTree = SOURCE_ROOT; };\n'
        f"\t\t{ID['product']} /* HarnessUITests.xctest */ = {{isa = PBXFileReference; "
        "explicitFileType = wrapper.cfbundle; includeInIndex = 0; "
        "path = HarnessUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR; };\n",
    )
    text = add(
        text,
        "PBXContainerItemProxy",
        f"\t\t{ID['proxy']} /* PBXContainerItemProxy */ = {{\n"
        "\t\t\tisa = PBXContainerItemProxy;\n"
        f"\t\t\tcontainerPortal = {PROJECT} /* Project object */;\n"
        "\t\t\tproxyType = 1;\n"
        f"\t\t\tremoteGlobalIDString = {APP_TARGET};\n"
        '\t\t\tremoteInfo = "Data Cards";\n'
        "\t\t};\n",
    )
    text = add(
        text,
        "PBXTargetDependency",
        f"\t\t{ID['dep']} /* PBXTargetDependency */ = {{\n"
        "\t\t\tisa = PBXTargetDependency;\n"
        f"\t\t\ttarget = {APP_TARGET} /* Data Cards */;\n"
        f"\t\t\ttargetProxy = {ID['proxy']} /* PBXContainerItemProxy */;\n"
        "\t\t};\n",
    )
    for section, key, files in (
        ("PBXSourcesBuildPhase", "sources", f"\t\t\t\t{ID['build']},\n"),
        ("PBXFrameworksBuildPhase", "frameworks", ""),
    ):
        text = add(
            text,
            section,
            f"\t\t{ID[key]} = {{\n"
            f"\t\t\tisa = {section};\n"
            "\t\t\tbuildActionMask = 2147483647;\n"
            f"\t\t\tfiles = (\n{files}\t\t\t);\n"
            "\t\t\trunOnlyForDeploymentPostprocessing = 0;\n"
            "\t\t};\n",
        )
    text = add(
        text,
        "PBXGroup",
        f"\t\t{ID['group']} /* HarnessUITests */ = {{\n"
        "\t\t\tisa = PBXGroup;\n"
        f"\t\t\tchildren = (\n\t\t\t\t{ID['file']},\n\t\t\t);\n"
        "\t\t\tname = HarnessUITests;\n"
        '\t\t\tsourceTree = "<group>";\n'
        "\t\t};\n",
    )
    text = add(
        text,
        "PBXNativeTarget",
        f"\t\t{ID['target']} /* HarnessUITests */ = {{\n"
        "\t\t\tisa = PBXNativeTarget;\n"
        f"\t\t\tbuildConfigurationList = {ID['configs']};\n"
        f"\t\t\tbuildPhases = (\n\t\t\t\t{ID['sources']},\n\t\t\t\t{ID['frameworks']},\n\t\t\t);\n"
        "\t\t\tbuildRules = (\n\t\t\t);\n"
        f"\t\t\tdependencies = (\n\t\t\t\t{ID['dep']},\n\t\t\t);\n"
        "\t\t\tname = HarnessUITests;\n"
        "\t\t\tproductName = HarnessUITests;\n"
        f"\t\t\tproductReference = {ID['product']};\n"
        '\t\t\tproductType = "com.apple.product-type.bundle.ui-testing";\n'
        "\t\t};\n",
    )
    configs = config("debug", "Debug") + config("release", "Release")
    text = add(text, "XCBuildConfiguration", configs)
    text = add(
        text,
        "XCConfigurationList",
        f"\t\t{ID['configs']} = {{\n"
        "\t\t\tisa = XCConfigurationList;\n"
        "\t\t\tbuildConfigurations = (\n"
        f"\t\t\t\t{ID['debug']},\n\t\t\t\t{ID['release']},\n\t\t\t);\n"
        "\t\t\tdefaultConfigurationIsVisible = 0;\n"
        "\t\t\tdefaultConfigurationName = Release;\n"
        "\t\t};\n",
    )

    # The new target into the project's list, and the project directory up one.
    head, sep, tail = text.partition("/* Begin PBXProject section */")
    project, end, rest = tail.partition("/* End PBXProject section */")
    if "targets = (" not in project or 'projectDirPath = "";' not in project:
        raise SystemExit(f"{SOURCE}: the PBXProject section has changed shape")
    project = project.replace("targets = (\n", f"targets = (\n\t\t\t\t{ID['target']},\n", 1)
    project = project.replace('projectDirPath = "";', "projectDirPath = ..;", 1)
    return head + sep + project + end + rest


def scheme() -> str:
    def ref(blueprint: str, product: str, name: str) -> str:
        return (
            f'<BuildableReference BuildableIdentifier = "primary" '
            f'BlueprintIdentifier = "{blueprint}" BuildableName = "{product}" '
            f'BlueprintName = "{name}" ReferencedContainer = "container:{CONTAINER}">'
            "</BuildableReference>"
        )

    app = ref(APP_TARGET, "Data Cards.app", "Data Cards")
    tests = ref(ID["target"], "HarnessUITests.xctest", "HarnessUITests")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "2660" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "NO" buildForArchiving = "NO" buildForAnalyzing = "NO">
            {app}
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "" selectedLauncherIdentifier = "Xcode.IDEFoundation.Launcher.PosixSpawn" shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
         <TestableReference skipped = "NO">
            {tests}
         </TestableReference>
      </Testables>
   </TestAction>
</Scheme>
"""  # noqa: E501


def main() -> None:
    schemes = OUT / "xcshareddata" / "xcschemes"
    schemes.mkdir(parents=True, exist_ok=True)
    (OUT / "project.pbxproj").write_text(harness(SOURCE.read_text()))
    (schemes / "Harness.xcscheme").write_text(scheme())
    print(OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
