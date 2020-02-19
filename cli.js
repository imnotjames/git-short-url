#!/usr/bin/env node

const Commander = require('commander');
const chalk = require('chalk');
const ConfigStore = require('configstore');

const { Repository } = require('./repository');
const { Publisher } = require('./publish');

const pkg = require('./package.json');

const program = new Commander.Command();
const config = new ConfigStore(pkg.name, {},{ globalConfigPath: true });

const CONFIG_REPOSITORY_PATH = 'repository.path';
const CONFIG_REPOSITORY_BRANCH = 'repository.branch';
const CONFIG_REPOSITORY_UPSTREAM = 'repository.upstream';


function repositoryFromConfig() {
  const repoPath = config.get(CONFIG_REPOSITORY_PATH) || '.';
  const branch = config.get(CONFIG_REPOSITORY_BRANCH) || 'master';
  const upstream = config.get(CONFIG_REPOSITORY_UPSTREAM) || 'origin';

  return new Repository(repoPath, { branch, upstream });
}

function catchErrors(command, ...args) {
  return async (...args) => {
    try {
      return await command(...args);
    } catch(e) {
      console.log(chalk.red(e.stack));
      process.exitCode = 1
    }
  }
}


program.version(pkg.version);

program
    .command('config [key] [value]')
    .description('Set Configuration Values for short')
    .option('-a --all')
    .action(catchErrors(async (key, value, { all }) => {
      let previousValue = config.has(key) ? config.get(key) : undefined;

      if (all) {
        for (let [key, value] of Object.entries(config.all)) {
          console.log(`${key}=${value}`);
        }

        return;
      } else if (!key) {
        console.error('Key must be specified if `--all` is not set');
        process.exit(1);
        return;
      }

      if (typeof(value) === 'undefined') {
        value = previousValue;
      } else if (value !== previousValue) {
        config.set(key, value);
      }

      console.log(`${key}=${value}`);
    }));

program
    .command('info <short-id>')
    .description('')
    .action(catchErrors(async (shortId) => {
      const repository = repositoryFromConfig();

      let shortUrl = await repository.get(shortId);

      console.log(shortUrl);
    }));

program
    .command('publish')
    .description('')
    .option('--output-dir <directory>', 'Where to store the indexed items', '.')
    .option('--from <ref>', 'Index only since this ref')
    .option('--until <ref>', 'Index only until this ref')
    .action(catchErrors(async ({outputDir, from, until}) => {

        const repository = repositoryFromConfig();

        const publisher = new Publisher(outputDir);

        let count = 0;

        for await (let commit of repository.all({from, until})) {
          publisher.publish(commit);
          count++;
        }

        console.log(`Published ${count} urls`);
    }));

program
    .arguments('<url> [description...]')
    .description('Create a short URL')
    .action(catchErrors(async (url, description) => {
        description = description.join(' ');

        const repository = repositoryFromConfig();

        let commit = await repository.create({
          url,
          description
        });

        console.log(commit);
    }));


if (!process.argv.slice(2).length) {
  program.outputHelp();
} else {
  program.parseAsync(process.argv);
}