#!/usr/bin/env node
import * as fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import chalk from 'chalk';
import * as esbuild from 'esbuild';
import { copy } from 'esbuild-plugin-copy';
import { sassPlugin } from 'esbuild-sass-plugin';
import fsPkg from 'fs-extra';
import livereload from 'gulp-livereload';
import moment from 'moment';
import * as buildInfo from 'preval-build-info';
import glob from 'tiny-glob';
import prepareZLPicksRecipes from './build-helpers/prepare-zl-picks-recipes.cjs';

const { log } = console;

const outDir = 'build';

const staticAssets = () => [
  copy({
    assets: {
      from: ['./src/internal-server/**/*.{json,ini,edge,css,png,sqlite}'],
      to: ['./internal-server'],
    },
  }),
  copy({
    assets: {
      from: ['./src/internal-server/ace'],
      to: ['./internal-server'],
    },
  }),
  copy({
    assets: {
      from: ['./src/**/*.json'],
      to: ['./'],
    },
  }),
  copy({
    assets: {
      from: ['./src/assets/**'],
      to: ['./assets'],
    },
  }),
  copy({
    assets: {
      from: ['./src/index.html'],
      to: ['./'],
    },
  }),
];

const copyManualAssets = () => {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
  }
  prepareZLPicksRecipes('recipes', `${outDir}/recipes`);
  fs.copyFileSync('package.json', `${outDir}/package.json`);
  fs.copyFileSync('electron-builder.npmrc', `${outDir}/.npmrc`);
  fs.copyFileSync(
    'node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js',
    `${outDir}/wppconnect-wa.js`,
  );
  fs.copyFileSync(
    'node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js.LICENSE.txt',
    `${outDir}/wppconnect-wa.js.LICENSE.txt`,
  );
  fs.copyFileSync(
    'node_modules/@wppconnect/wa-js/LICENSE',
    `${outDir}/WA-JS-LICENSE`,
  );

  const buildInfoData = {
    timestamp: buildInfo.timestamp,
    gitHashShort: buildInfo.gitHashShort,
    gitBranch: buildInfo.gitBranch,
  };
  fsPkg.outputJsonSync(`${outDir}/buildInfo.json`, buildInfoData);
};

const runEsbuild = async () => {
  const startTime = performance.now();

  const myArgs = process.argv.slice(2);
  const isDev = myArgs.includes('--watch');
  log(chalk.blue('Starting with args'), myArgs);

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { force: true, recursive: true });
    log(chalk.blue('Cleaning'), outDir);
  }
  copyManualAssets();

  // Source files
  // Guest functions are serialized with toString(); keepNames would capture
  // esbuild's module-scope __name helper inside otherwise self-contained code.
  const guestEntries = [
    'src/features/accounts/whatsapp.ts',
    'src/features/accounts/unread.ts',
    'src/features/accounts/layout.ts',
    'src/features/accounts/voice.ts',
    'src/webview/downloads.ts',
    'src/features/accountTools/guest.ts',
    'src/features/accountTools/bulkGuest.ts',
    'src/features/customers/guest.ts',
    'src/features/groups/guest.ts',
    'src/features/reactions/guest.ts',
    'src/features/reactions/image.ts',
    'src/features/chatBackup/guest.ts',
  ];
  const sourceEntries = await glob('./src/**/*.{ts,tsx,js,jsx}');
  const entryPoints = sourceEntries.filter(
    path => !guestEntries.includes(path.replace(/^\.\//, '')),
  );

  // Scss entry points
  entryPoints.push(
    'src/styles/main.scss',
    'src/styles/vertical.scss',
    'src/styles/animations.scss',
  );

  // Run build
  await esbuild.build({
    entryPoints,
    format: 'cjs',
    minify: false,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    keepNames: true,
    outdir: outDir,
    watch: isDev && {
      onRebuild(error, result) {
        if (error) {
          log(chalk.red(`watch build failed: ${error}`));
        } else {
          log(chalk.blue('watch build success:'), result);
          livereload.reload();
        }
      },
    },
    incremental: isDev,
    plugins: [sassPlugin(), ...staticAssets()],
  });

  await esbuild.build({
    entryPoints: guestEntries,
    outbase: 'src',
    format: 'cjs',
    keepNames: false,
    minifyWhitespace: true,
    minifyIdentifiers: true,
    outdir: outDir,
    incremental: isDev,
    watch: isDev && {
      onRebuild(error) {
        if (error) log(chalk.red(`guest build failed: ${error}`));
        else livereload.reload();
      },
    },
  });

  if (isDev) {
    const serveResult = await esbuild.serve(
      {
        servedir: outDir,
        port: 8080,
      },
      {},
    );
    log(chalk.green(`Listening on ${serveResult.host}:${serveResult.port}`));
    livereload.listen();
  } else {
    const endTime = performance.now();
    const duration = endTime - startTime;
    log(
      chalk.green(`Completed build in ${moment(duration).format('ss.m')}sec`),
    );
  }
};

await runEsbuild();
