const fs = require('fs');
const path = require('path');
const util = require('util');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const mkdir = util.promisify(fs.mkdir)

const Handlebars = require('handlebars');


async function mkdirp(filename) {
  const parent = path.dirname(filename);

  if (parent === filename) {
    try {
      return await mkdir(filename);
    } catch (e) {
      // swallowed by recursive implementation on posix systems
      // any other error is a failure
      if (e.code === 'EISDIR') {
        return;
      }

      throw e;
    }
  }

  try {
    await mkdir(filename);
  } catch (e) {
    if (e.code === 'ENOENT') {
      await mkdirp(parent);
      await mkdirp(filename);
    } else if (e.code !== 'EEXIST' && e.code !== 'EROFS') {
      throw e;
    }
  }
}



class Publisher {
  template = new Promise(async (resolve) => {
    const templatePath = path.join(__dirname, 'templates/redirect.handlebars');
    const templateText = await readFile(templatePath, { encoding: 'utf8' });

    resolve(Handlebars.compile(templateText));
  });

  constructor(directory = '') {
    this.directory = directory;
  }

  async publish(commit) {
    let template = await this.template;

    let redirectPath = path.join(this.directory, commit.shortId, 'index.html');

    console.log(redirectPath);

    await mkdirp(path.dirname(redirectPath));

    await writeFile(redirectPath, template(commit));
  }
}

module.exports = { Publisher };