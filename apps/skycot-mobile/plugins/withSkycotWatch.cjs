"use strict";
// SKYCOT on a grown-up's Apple Watch (Phase 4): adds the SwiftUI Watch app in
// apps/skycot-mobile/watch/SkycotWatch to the Xcode project `expo prebuild` makes, as the
// standard companion arrangement: its own watchOS target (one target, watchOS 11 and later,
// Apple's current layout), bundle id `<iOS bundle id>.watchkitapp`, embedded in the iPhone app's
// Watch folder, built whenever the iPhone app is built. React Native doesn't run on watchOS, so
// the Watch app is plain Swift; it talks only to the iPhone app (WatchConnectivity).
//
// The Swift files stay where they are (in git); only the Xcode wiring and the Watch's icon
// catalog (copied from nondev/brand/assets) are generated, inside the generated ios/ folder.
// Nothing here signs, uploads or touches an Apple account: the team id is the app's own, and
// Simulator builds need no profile.

const path = require("path");
const fs = require("fs");
const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const TARGET = "SkycotWatch";
const SOURCES_DIR = "../watch/SkycotWatch";
const ASSETS_DIR = "SkycotWatchAssets";
const WATCHOS = "11.0";
const ICON = "../../nondev/brand/assets/ios-android/ios/AppIcon.appiconset/AppIcon-day-1024.png";

const q = (value) => `"${value}"`;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

/** The Watch's asset catalog: SKYCOT's day icon (watchOS masks it to a circle) and the accent. */
function withWatchAssets(config) {
  return withDangerousMod(config, [
    "ios",
    (cfg) => {
      const catalog = path.join(cfg.modRequest.platformProjectRoot, ASSETS_DIR, "Assets.xcassets");
      fs.rmSync(catalog, { recursive: true, force: true });
      const info = { author: "xcode", version: 1 };
      writeJson(path.join(catalog, "Contents.json"), { info });
      writeJson(path.join(catalog, "AppIcon.appiconset", "Contents.json"), {
        images: [
          { filename: "icon-1024.png", idiom: "universal", platform: "watchos", size: "1024x1024" },
        ],
        info,
      });
      fs.copyFileSync(
        path.join(cfg.modRequest.projectRoot, ICON),
        path.join(catalog, "AppIcon.appiconset", "icon-1024.png"),
      );
      writeJson(path.join(catalog, "AccentColor.colorset", "Contents.json"), {
        colors: [
          {
            color: {
              "color-space": "srgb",
              components: { alpha: "1.000", blue: "0xFF", green: "0x9B", red: "0x3D" },
            },
            idiom: "universal",
          },
        ],
        info,
      });
      return cfg;
    },
  ]);
}

function addObject(objects, section, uuid, value, comment) {
  objects[section] = objects[section] || {};
  objects[section][uuid] = value;
  if (comment) objects[section][`${uuid}_comment`] = comment;
}

function addWatchTarget(project, options) {
  const objects = project.hash.project.objects;
  if (project.pbxTargetByName(TARGET)) return;
  const uuid = () => project.generateUuid();
  const projectRoot = options.projectRoot;
  const sourceDir = path.join(projectRoot, "watch", "SkycotWatch");
  const swiftFiles = fs
    .readdirSync(sourceDir)
    .filter((name) => name.endsWith(".swift"))
    .sort();

  // Files: the Swift sources in place, the Info.plist, and the generated asset catalog.
  const sourceGroup = uuid();
  const children = [];
  const sourceBuildFiles = [];
  const resourceBuildFiles = [];
  for (const name of [...swiftFiles, "Info.plist", "PrivacyInfo.xcprivacy"]) {
    const ref = uuid();
    addObject(
      objects,
      "PBXFileReference",
      ref,
      {
        isa: "PBXFileReference",
        lastKnownFileType: name.endsWith(".swift")
          ? "sourcecode.swift"
          : name.endsWith(".xcprivacy")
            ? "text.xml"
            : "text.plist.xml",
        path: q(name),
        sourceTree: q("<group>"),
      },
      name,
    );
    children.push({ value: ref, comment: name });
    if (name.endsWith(".swift")) {
      const build = uuid();
      addObject(
        objects,
        "PBXBuildFile",
        build,
        { isa: "PBXBuildFile", fileRef: ref, fileRef_comment: name },
        `${name} in Sources`,
      );
      sourceBuildFiles.push({ value: build, comment: `${name} in Sources` });
    } else if (name.endsWith(".xcprivacy")) {
      // Apple's privacy manifest travels inside the Watch app.
      const build = uuid();
      addObject(
        objects,
        "PBXBuildFile",
        build,
        { isa: "PBXBuildFile", fileRef: ref, fileRef_comment: name },
        `${name} in Resources`,
      );
      resourceBuildFiles.push({ value: build, comment: `${name} in Resources` });
    }
  }
  const catalogRef = uuid();
  addObject(
    objects,
    "PBXFileReference",
    catalogRef,
    {
      isa: "PBXFileReference",
      lastKnownFileType: "folder.assetcatalog",
      path: "Assets.xcassets",
      sourceTree: q("<group>"),
    },
    "Assets.xcassets",
  );
  const assetsGroup = uuid();
  addObject(
    objects,
    "PBXGroup",
    assetsGroup,
    {
      isa: "PBXGroup",
      children: [{ value: catalogRef, comment: "Assets.xcassets" }],
      // Inside the sources group (../watch/SkycotWatch), pointing back into the generated ios/.
      name: ASSETS_DIR,
      path: q(`../../ios/${ASSETS_DIR}`),
      sourceTree: q("<group>"),
    },
    ASSETS_DIR,
  );
  children.push({ value: assetsGroup, comment: ASSETS_DIR });
  addObject(
    objects,
    "PBXGroup",
    sourceGroup,
    { isa: "PBXGroup", children, name: TARGET, path: q(SOURCES_DIR), sourceTree: q("<group>") },
    TARGET,
  );
  const catalogBuild = uuid();
  addObject(
    objects,
    "PBXBuildFile",
    catalogBuild,
    { isa: "PBXBuildFile", fileRef: catalogRef, fileRef_comment: "Assets.xcassets" },
    "Assets.xcassets in Resources",
  );

  const mainGroup = objects.PBXGroup[project.getFirstProject().firstProject.mainGroup];
  mainGroup.children.push({ value: sourceGroup, comment: TARGET });

  // The built SkycotWatch.app, listed under Products so the iPhone app can embed it.
  const productRef = uuid();
  addObject(
    objects,
    "PBXFileReference",
    productRef,
    {
      isa: "PBXFileReference",
      explicitFileType: "wrapper.application",
      includeInIndex: 0,
      path: `${TARGET}.app`,
      sourceTree: "BUILT_PRODUCTS_DIR",
    },
    `${TARGET}.app`,
  );
  const productsGroupKey = Object.keys(objects.PBXGroup).find(
    (key) => !key.endsWith("_comment") && objects.PBXGroup[key].name === "Products",
  );
  if (productsGroupKey) {
    objects.PBXGroup[productsGroupKey].children.push({
      value: productRef,
      comment: `${TARGET}.app`,
    });
  }

  // Build phases for the Watch target.
  const phase = (section, files, comment) => {
    const id = uuid();
    addObject(
      objects,
      section,
      id,
      { isa: section, buildActionMask: 2147483647, files, runOnlyForDeploymentPostprocessing: 0 },
      comment,
    );
    return { value: id, comment };
  };
  const sources = phase("PBXSourcesBuildPhase", sourceBuildFiles, "Sources");
  const frameworks = phase("PBXFrameworksBuildPhase", [], "Frameworks");
  const resources = phase(
    "PBXResourcesBuildPhase",
    [{ value: catalogBuild, comment: "Assets.xcassets in Resources" }, ...resourceBuildFiles],
    "Resources",
  );

  // Build settings.
  const settings = (debug) => ({
    ASSETCATALOG_COMPILER_APPICON_NAME: "AppIcon",
    ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: "AccentColor",
    CLANG_ENABLE_MODULES: "YES",
    CODE_SIGN_STYLE: "Automatic",
    CURRENT_PROJECT_VERSION: q(options.buildNumber),
    ...(options.teamId ? { DEVELOPMENT_TEAM: options.teamId } : {}),
    ENABLE_PREVIEWS: "NO",
    GENERATE_INFOPLIST_FILE: "NO",
    INFOPLIST_FILE: q(`${SOURCES_DIR}/Info.plist`),
    LD_RUNPATH_SEARCH_PATHS: q("$(inherited) @executable_path/Frameworks"),
    MARKETING_VERSION: q(options.version),
    PRODUCT_BUNDLE_IDENTIFIER: q(options.bundleIdentifier),
    PRODUCT_NAME: q("$(TARGET_NAME)"),
    SDKROOT: "watchos",
    SKIP_INSTALL: "YES",
    SKYCOT_COMPANION_BUNDLE_ID: q(options.companionBundleIdentifier),
    SKYCOT_WATCH_DISPLAY_NAME: q(options.displayName),
    SUPPORTED_PLATFORMS: q("watchos watchsimulator"),
    SWIFT_EMIT_LOC_STRINGS: "NO",
    SWIFT_OPTIMIZATION_LEVEL: q(debug ? "-Onone" : "-O"),
    SWIFT_VERSION: "5.0",
    TARGETED_DEVICE_FAMILY: "4",
    WATCHOS_DEPLOYMENT_TARGET: WATCHOS,
    ...(debug ? { SWIFT_ACTIVE_COMPILATION_CONDITIONS: q("DEBUG $(inherited)") } : {}),
  });
  const debugConfig = uuid();
  const releaseConfig = uuid();
  addObject(
    objects,
    "XCBuildConfiguration",
    debugConfig,
    { isa: "XCBuildConfiguration", buildSettings: settings(true), name: "Debug" },
    "Debug",
  );
  addObject(
    objects,
    "XCBuildConfiguration",
    releaseConfig,
    { isa: "XCBuildConfiguration", buildSettings: settings(false), name: "Release" },
    "Release",
  );
  const configList = uuid();
  addObject(
    objects,
    "XCConfigurationList",
    configList,
    {
      isa: "XCConfigurationList",
      buildConfigurations: [
        { value: debugConfig, comment: "Debug" },
        { value: releaseConfig, comment: "Release" },
      ],
      defaultConfigurationIsVisible: 0,
      defaultConfigurationName: "Release",
    },
    `Build configuration list for PBXNativeTarget "${TARGET}"`,
  );

  // A single-target watchOS app (Xcode 14 and later): no separate WatchKit extension.
  const target = uuid();
  addObject(
    objects,
    "PBXNativeTarget",
    target,
    {
      isa: "PBXNativeTarget",
      buildConfigurationList: configList,
      buildConfigurationList_comment: `Build configuration list for PBXNativeTarget "${TARGET}"`,
      buildPhases: [sources, frameworks, resources],
      buildRules: [],
      dependencies: [],
      name: TARGET,
      productName: TARGET,
      productReference: productRef,
      productReference_comment: `${TARGET}.app`,
      productType: q("com.apple.product-type.application"),
    },
    TARGET,
  );
  const pbxProject = project.getFirstProject().firstProject;
  pbxProject.targets.push({ value: target, comment: TARGET });
  pbxProject.attributes = pbxProject.attributes || {};
  pbxProject.attributes.TargetAttributes = pbxProject.attributes.TargetAttributes || {};
  pbxProject.attributes.TargetAttributes[target] = { CreatedOnToolsVersion: "26.0" };

  // The iPhone app depends on the Watch app and carries it in its Watch folder.
  const mainTarget = project.getFirstTarget();
  const proxy = uuid();
  addObject(
    objects,
    "PBXContainerItemProxy",
    proxy,
    {
      isa: "PBXContainerItemProxy",
      containerPortal: project.hash.project.rootObject,
      containerPortal_comment: "Project object",
      proxyType: 1,
      remoteGlobalIDString: target,
      remoteInfo: TARGET,
    },
    "PBXContainerItemProxy",
  );
  const dependency = uuid();
  addObject(
    objects,
    "PBXTargetDependency",
    dependency,
    {
      isa: "PBXTargetDependency",
      target,
      target_comment: TARGET,
      targetProxy: proxy,
      targetProxy_comment: "PBXContainerItemProxy",
    },
    "PBXTargetDependency",
  );
  mainTarget.firstTarget.dependencies.push({ value: dependency, comment: "PBXTargetDependency" });

  const embedBuild = uuid();
  addObject(
    objects,
    "PBXBuildFile",
    embedBuild,
    {
      isa: "PBXBuildFile",
      fileRef: productRef,
      fileRef_comment: `${TARGET}.app`,
      settings: { ATTRIBUTES: ["RemoveHeadersOnCopy"] },
    },
    `${TARGET}.app in Embed Watch Content`,
  );
  const embed = uuid();
  addObject(
    objects,
    "PBXCopyFilesBuildPhase",
    embed,
    {
      isa: "PBXCopyFilesBuildPhase",
      buildActionMask: 2147483647,
      dstPath: q("$(CONTENTS_FOLDER_PATH)/Watch"),
      dstSubfolderSpec: 16,
      files: [{ value: embedBuild, comment: `${TARGET}.app in Embed Watch Content` }],
      name: q("Embed Watch Content"),
      runOnlyForDeploymentPostprocessing: 0,
    },
    "Embed Watch Content",
  );
  mainTarget.firstTarget.buildPhases.push({ value: embed, comment: "Embed Watch Content" });
}

function withWatchTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const companion = cfg.ios?.bundleIdentifier;
    if (!companion) throw new Error("SKYCOT Watch: ios.bundleIdentifier is required.");
    addWatchTarget(cfg.modResults, {
      projectRoot: cfg.modRequest.projectRoot,
      bundleIdentifier: `${companion}.watchkitapp`,
      companionBundleIdentifier: companion,
      displayName: cfg.name,
      teamId: cfg.ios?.appleTeamId ?? null,
      version: cfg.ios?.version ?? cfg.version ?? "1.0",
      buildNumber: cfg.ios?.buildNumber ?? "1",
    });
    return cfg;
  });
}

module.exports = function withSkycotWatch(config) {
  return withWatchTarget(withWatchAssets(config));
};
module.exports.addWatchTarget = addWatchTarget;
