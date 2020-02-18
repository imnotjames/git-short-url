#!/usr/bin/env node

const Commander = require('commander');
const ConfigStore = require('configstore');

const { Repository } = require('./repository');
const { Publisher } = require('./publish');

const pkg = require('./package.json');

const program = new Commander.Command();
const config = new ConfigStore(pkg.name, {},{ globalConfigPath: true });

const CONFIG_REPOSITORY_PATH = 'repository';
const CONFIG_REPOSITORY_BRANCH = 'branch';
const CONFIG_REPOSITORY_UPSTREAM = 'upstream';


function repositoryFromConfig() {
  const repoPath = config.get(CONFIG_REPOSITORY_PATH) || '.';
  const branch = config.get(CONFIG_REPOSITORY_BRANCH) || 'master';
  const upstream = config.get(CONFIG_REPOSITORY_UPSTREAM) || 'upstream';

  return new Repository(repoPath, { branch, upstream });
}

program.version(pkg.version);

program
    .command('config [key] [value]')
    .description('Set Configuration Values for short')
    .option('-a --all')
    .action(async (key, value, { all }) => {
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
    });

program
    .command('info <short-id>')
    .description('')
    .action(async (shortId) => {
      const repository = repositoryFromConfig();

      let shortUrl = await repository.get(shortId);

      console.log(shortUrl);
    });

program
    .command('publish')
    .description('')
    .option('--output-dir', 'Where to store the indexed items', '.')
    .option('--from <ref>', 'Index only since this ref')
    .option('--until <ref>', 'Index only until this ref')
    .action(async ({outputDir, from, until}) => {
        const repository = repositoryFromConfig();

        const publisher = new Publisher(outputDir)

        for await (let commit of repository.all({ from, until })) {
          publisher.publish(commit);
        }
    });

program
    .arguments('<url> [description...]')
    .description('Create a short URL')
    .action(async (url, description) => {
        description = description.join(' ');

        const repository = repositoryFromConfig();

        let commit = await repository.create({
          url,
          description
        });

        console.log(commit);
    });

program.parseAsync(process.argv);