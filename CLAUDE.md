# MRE Project Instructions

## Build & Release

### Development
```
npm run tauri dev
```

### Production Build
```
npm run tauri build -- --bundles app
```

### Sign, Notarize & Install
Apple credentials are in `.env` (APPLE_ID, APPLE_TEAM_ID, APPLE_PASSWORD).

```bash
# 1. Sign
codesign --deep --force --options runtime \
  --sign "Developer ID Application: Derrick Woolworth (45Q224N5J4)" \
  src-tauri/target/release/bundle/macos/MRE.app

# 2. Zip for notarization
cd src-tauri/target/release/bundle/macos && ditto -c -k --keepParent MRE.app MRE.zip

# 3. Notarize (source .env for credentials)
source .env && xcrun notarytool submit src-tauri/target/release/bundle/macos/MRE.zip \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_PASSWORD" --wait

# 4. Staple
xcrun stapler staple src-tauri/target/release/bundle/macos/MRE.app

# 5. Install
rm -rf /Applications/MRE.app && cp -R src-tauri/target/release/bundle/macos/MRE.app /Applications/
```
