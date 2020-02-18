const child_process = require('child_process');
const util = require('util');

const matter = require('gray-matter');
const { Commit, Oid, Repository: NodeRepository, Reference, Revwalk, Signature, Error: NodeGitError } = require('nodegit');
const path = require('path');
const { URL, parse } = require('url');
const YAML = require('yaml');
const base58 = require('base-58');

const exec = util.promisify(child_process.exec);


const MINIMUM_HASH = 4;


const VALID_PROTOCOLS = [
    'http',
    'https',
    'ftp',
];

function isValidURL(url) {
  try {
    new URL(url);
    const parsed = parse(url);
    return VALID_PROTOCOLS.map(x => `${x.toLowerCase()}:`).includes(parsed.protocol);
  } catch (err) {
    return false;
  }
}


async function disambigateCommit(repo, ambiguousId) {
  if (!ambiguousId.match(/^[a-fA-F0-9]{4,}$/)) {
    return null;
  }

  // Only hex so this should be safe!
  let { stdout } = await exec(`git rev-parse --disambiguate=${ambiguousId}`, { cwd: repo.path() });

  let commits = stdout.trim().split("\n");

  for (let id of commits) {
    try {
      return await repo.getCommit(id);
    } catch (e) {

    }
  }
}

async function getCommitFromShortCommitId(repo, shortId) {
  try {
    return await Commit.lookupPrefix(repo, Oid.fromString(shortId), shortId.length);
  } catch (e) {
    if (e.errno !== NodeGitError.CODE.EAMBIGUOUS) {
      throw e;
    }

    return disambigateCommit(repo, shortId);
  }
}

async function getShortId(repo, commit, { hashLength = MINIMUM_HASH} = {}) {
  let longId = String(commit.id());

  while (hashLength <= longId.length) {
    let shortId = longId.slice(0, hashLength);

    let shortCommit = await getCommitFromShortCommitId(repo, shortId);

    if (shortCommit && String(shortCommit.id()) === longId) {
      let shortIdBuffer = Buffer.from(shortId, 'hex');

      return base58.encode(shortIdBuffer);
    }

    hashLength += 2;
  }
}

async function formatRedirectCommit(repo, commit) {
  let { content: description, data, isEmpty } = matter(commit.message().trim());

  if (!isValidURL(data.url)) {
    throw new Error('Commit is not a Redirect');
  }

  let id = await getShortId(repo, commit, { hashLength: 40 });

  let shortId = await getShortId(repo, commit);

  let offset = commit.author().when().offset() * 60;
  let created = new Date((commit.author().when().time() + offset) * 1000);
  let creator = commit.author().name();

  return {
    id,
    shortId,
    description,
    created,
    creator,
    ...data
  }
}

class Repository {
  constructor(repoPath, { branch = 'master', upstream = 'origin' }) {
    this.path = repoPath;
    this.branch = branch;
  }

  async get(id) {
    const repo = await NodeRepository.open(path.join(this.path, '.git'));

    let shortCommitId = Buffer.from(base58.decode(id)).toString('hex');

    let commit = await getCommitFromShortCommitId(shortCommitId);

    if (!commit) {
      throw new Error('Commit Not Found');
    }

    return await formatRedirectCommit(repo, commit);
  }

  async* all({ from, until } = {}) {
    const repo = await NodeRepository.open(path.resolve(path.join(this.path, '.git')));

    let walker = repo.createRevWalk();

    walker.reset();

    if (!until) {
      let latestCommit = await repo.getBranchCommit(this.branch);
      until = String(latestCommit.id());
    }

    if (from) {
      let range = `${from}^..${range}`;
      walker.pushRange(range);
    } else {
      walker.push(until);
    }

    walker.sorting(Revwalk.SORT.TIME, Revwalk.SORT.REVERSE);

    while (true) {
      let id;

      try {
        id = await walker.next();
      } catch (error) {
        if (error.errno === NodeGitError.CODE.ITEROVER) {
          break;
        }

        throw error;
      }

      try {
        let commit = await repo.getCommit(id);

        yield await formatRedirectCommit(repo, commit);
      } catch {
        // Do nothing
      }
    }
  }

  async create({ url, description, ...extra }) {
    if (!isValidURL(url)) {
      throw new Error('A Valid URL is required.');
    }

    const repo = await NodeRepository.open(path.join(this.path, '.git'));
    await repo.checkoutBranch(this.branch);
    const index = await repo.refreshIndex();

    let metadata = {
      url,
      ...extra
    };

    description = description || '';

    // Craft our Commit Message.
    const message = `---\n${YAML.stringify(metadata)}---\n${description}`;

    // Clear the index - don't accidentally write anything we don't mean to..
    await index.removeAll();
    await index.write();

    let oid = await index.writeTree();
    let headId = await Reference.nameToId(repo, "HEAD");

    let parent = await repo.getCommit(headId);

    const author = await Signature.default(repo);
    const committer = await Signature.default(repo);

    let id = await repo.createCommit("HEAD", author, committer, message, oid, [parent]);
    let commit = await repo.getCommit(id);

    return await formatRedirectCommit(repo, commit)
  }
}

module.exports = { Repository };