# iOS Build — Blockers Requiring Mac + Xcode

These issues were identified in code review of PR #3 but cannot be fixed from the Ubuntu dev server.
They must be resolved before the first TestFlight build.

## Blocker 1: CustomViewController.swift not registered in Xcode project

**File:** `frontend/ios/App/App.xcodeproj/project.pbxproj`

`CustomViewController.swift` exists on disk but has no entry in the Xcode project file
(`PBXFileReference`, `PBXBuildFile`, or `PBXSourcesBuildPhase`). The class is never compiled.
The app will crash on launch with:

> Unknown class CustomViewController in Interface Builder file

**Fix (requires Mac + Xcode 15+):**
1. Open `frontend/ios/App/App.xcworkspace` in Xcode
2. In the Project Navigator, right-click the `App` group → Add Files to "App"
3. Select `frontend/ios/App/App/CustomViewController.swift`
4. Ensure "Add to targets: App" is checked → Add
5. Build (Cmd+B) to confirm it compiles
6. Commit the updated `project.pbxproj`

## Blocker 2: Storyboard toolsVersion is Xcode 10-era

**File:** `frontend/ios/App/App/Base.lproj/Main.storyboard`

`toolsVersion="14111"` corresponds to Xcode 10 (2018). Xcode 15/16 uses `toolsVersion="21000"`.
This self-corrects silently on first open in modern Xcode — Xcode will update the value and prompt
to save. Just save the file after opening and commit the updated storyboard.

This is minor and will not prevent a build, but will generate noise in git diffs if not resolved early.

## Notes

- Always open `App.xcworkspace` (not `App.xcodeproj`) — SPM dependencies are only resolved via the workspace
- Signing: Xcode → Signing & Capabilities → Team → select Apple Developer account; enable "Automatically manage signing"
- Deployment target: iOS 15.0, device family: iPad only
- After fixing Blocker 1, run in Simulator first to verify unmuted autoplay works before archiving
