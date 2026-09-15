// Metro, taught the monorepo. Expo's default server watches only this app, but
// the game's rules live one package up in @pitch-snake/engine (a workspace
// symlink hoisted to the repo-root node_modules), and the flag list in
// @pitch-snake/flags beside it. Without this, two things quietly broke live
// testing: an edit to the engine never triggered Fast Refresh (Metro was not
// watching the folder it lives in), and the hoisted symlink resolved only by
// luck on the dev server (it worked in `expo export` because that is a single
// full bundle, not a watched graph). watchFolders puts the whole repo under
// the watcher so a package edit reloads on the device, and nodeModulesPaths
// lets a require walk up to the root store where workspace deps are hoisted.
//
// This is Expo's documented monorepo setup, verbatim; see
// https://docs.expo.dev/guides/monorepos/ . Bundling behaviour is unchanged,
// only what Metro watches and where it looks.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
