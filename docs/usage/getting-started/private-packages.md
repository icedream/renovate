# Private package support

It's a very common requirement to be able to support private module/dependency lookups.
This page describes Renovate's approach to authentication.

First, a quick note on terminology:

- The terms `module`, `package` and `dependency` can mostly be used interchangeably below
- The terms `credentials`, `secrets` and `authentication` are also used interchangeably

## When does Renovate need credentials?

By default, the only credentials Renovate has are those for the "platform", i.e. GitHub, GitLab, etc.
If the token used has sufficient permissions, this will enable Renovate to lookup dependencies located in alternative repositories on the same host or any hosted on any embedded package registry on the same host.

It's also quite common to need to look up packages on other protected hosts, including npmjs, Docker Hub, or private registries like Nexus or Artifactory.
Any time you need Renovate to access such registries with credentials then you will need to provision them as part of your config.

There are four times in Renovate's behavior when it may need credentials:

- Resolving private config presets
- Looking up dependency versions
- Looking up release notes
- Passing to package managers when updating lock files or checksums

Note: if you self-host Renovate, and have a self-hosted registry which _doesn't_ require authentication to access, then such modules/packages are not considered "private" to Renovate.

## Private Config Presets

Renovate supports config presets, including those which are private.

Although npm presets were the first type supported, they are now deprecated and it is recommend that all users migrate to git-hosted "local" presets instead.
However if you do still use them, private modules should work if you configure the `npmrc` file including token credentials in your bot global config.
Credentials stored on disk (e.g. in `~/.npmrc`) are no longer supported.

The recommended way of using local presets is to configure then using "local" presets, e.g. `"extends": ["local>myorg/renovate-config"]`, and ensure that the platform token has access to that repo.

It's not recommended that you use a private repository to host your config while then extending it from a public repository.
If your preset doesn't contain secrets then you should make it public, while if it does contain secrets then it's better to split your preset between a public one which all repos extend, and a private one with secrets which only other private repos extend.

In summary, the recommended approach to private presets is:

- Host the presets on the same server/platform as other repositories
- Make sure you install Renovate into the preset repository so that it has credentials to access it from other private repos
- Use `local>....` syntax to refer to private presets

## Dependency Version Lookups

Whenever Renovate detects that a project uses a particular dependency, it attempts to look up that dependency to see if any new versions exist.
If such a package is private, then Renovate must be configured with the relevant credentials.
Renovate does not use any package managers for this step and performs all HTTP(S) lookups itself, including insertion of authentication headers.

Configuring Renovate with credentials requires `hostRules`.
Each host rule consists of a `hostType` value and/or a way to match against hosts using `matchHost`.

`hostType` is not particularly important at this step unless you have different credentials for the same host, however it is sometimes useful in later steps so is good to include if you can.
It can be either a "platform" name (e.g. `github`, `azure`, etc) or a "datasource" name (e.g. `npm`, `maven`, `github-tags`, etc).

If you want to apply credentials only for a nested path within a host then write `matchHost` as a base URL like `https://registry.company.com/nested/path/`.
If the same credentials apply to all paths on a host and not on any subdomains of it then configure `matchHost` with a protocol like `https://registry.company.com`.
Finally, to apply credentials to all hosts within the domain, use a `matchHost` value with no `https://` prefix, e.g. `company.com` or `registry.company.com`, both of which would apply to a host like `beta.registry.company.com`.

In addition to the above options to match against a host, you need to add the credentials.
Typically they are either `token`, or `username` + `password`.
Other credential terms are not supported yet.

Here is an example of some host rules:

```json
{
  "hostRules": [
    {
      "matchHost": "registry.npmjs.org",
      "token": "abc123"
    },
    {
      "matchHost": "https://registry.company.com/pypi-simple/",
      "username": "engineering",
      "password": "abc123"
    }
  ]
}
```

Renovate applies theses `hostRules` to every HTTP(s) request which is sent, so they are largely independent of any platform or datasource logic.
With `hostRules` in place, private package lookups should all work.

## Looking up Release Notes

When Renovate creates Pull Requests, its default behavior is to locate and embed release notes/changelogs of packages.
These release notes are fetched from the source repository of packages and not from the registries themselves, so if they are private then they will require different credentials.

When it comes to open source, most packages host their source on `github.com` in public repositories.
However, GitHub greatly rate limits unauthenticated API requests so there is a need to configure credentials for github.com as otherwise the bot will get rate limited quickly.
It can be confusing for people who host their own source code privately to be asked to configure a `github.com` token but without it Release Notes for most open source packages will be blocked.

Currently the preferred way to configure `github.com` credentials for self-hosted Renovate is:

- Create a read-only Personal Access Token (PAT) for a `github.com` account. This can be any GitHub account, it might be better to create an "empty" account just for this purpose.
- Add the PAT to Renovate using the environment variable `GITHUB_COM_TOKEN`

## Package Manager Credentials for Artifact Updating

In Renovate terminology, "artifacts" includes lock files, checksum files, and vendored dependencies.
One way of understanding artifacts is: "everything else that needs to be updated when the dependency version changes".

Not all package managers supported by Renovate require artifact updating, because not all use lock or checksum files.
But when such files need updating, Renovate does so by using the package managers themselves instead of trying to "reverse engineer" each package manager's file formats and behavior.
Importantly, such package managers are run via shell commands and do not understand Renovate's `hostRules` objects, so Renovate needs to reformat the credentials into formats (such as environment variables or configuration files) which the package manager understands.

Because of this need to convert `hostRules` credentials into a format which package managers understand, sometimes artifact updating can fail due to missing credentials.
Sometimes this can be resolved by changing Renovate configuration, but other times it may be due to a feature gap.
The following details the most common/popular manager artifacts updating and how credentials are passed:

### bundler

`hostRules` with `hostType=rubygems` are converted into environment variables which Bundler supports.

### composer

Any `hostRules` token for `github.com` or `gitlab.com` are found and written out to `COMPOSER_AUTH` in env for Composer to parse.
Any `hostRules` with `hostType=packagist` are also included.

### gomod

If a `github.com` token is found in `hostRules`, then it is written out to local git config prior to running `go` commands.
The command run is `git config --global url."https://${token}@github.com/".insteadOf "https://github.com/"`.

### npm

The recommended approaches in order of preference are:

1. **Self-hosted hostRules**: Configure a hostRules entry in the bot's `config.js` with the `hostType`, `matchHost` and `token` specified
1. **Renovate App with private modules from npmjs.org**: Add an encrypted `npmToken` to your Renovate config
1. **Renovate App with a private registry**: Add an unencrypted `npmrc` plus an encrypted `npmToken` in config

These approaches are described in full below.

#### Add hostRule to bots config

Define `hostRules` like this:

```js
module.exports = {
  hostRules: [
    {
      hostType: 'npm',
      matchHost: 'registry.npmjs.org',
      token: process.env.NPMJS_TOKEN,
    },
    {
      hostType: 'npm',
      matchHost:
        'https://pkgs.dev.azure.com/{organization}/{project}/_packaging/{feed}/npm/registry/',
      username: 'VssSessionToken',
      password: process.env.AZURE_NPM_TOKEN,
    },
    {
      // https://www.jfrog.com/confluence/display/JFROG/npm+Registry
      // Will be passed as `//artifactory.my-company.com/artifactory/api/npm/npm:_auth=<TOKEN>` to `.npmrc`
      hostType: 'npm',
      matchHost: 'https://artifactory.my-company.com/artifactory/api/npm/npm/',
      token: process.env.ARTIFACTORY_NPM_TOKEN,
      authType: 'Basic',
    },
  ],
};
```

**NOTE:** Remember to put a trailing slash at the end of your `matchHost` URL.

#### Add npmrc string to Renovate config

You can add an `.npmrc` authentication line to your Renovate config under the field `npmrc`. e.g. a `renovate.json` might look like this:

```json
{
  "npmrc": "//some.registry.com/:_authToken=abcdefghi-1234-jklmno-aac6-12345567889"
}
```

If configured like this, Renovate will use this to authenticate with npm and will ignore any `.npmrc` files(s) it finds checked into the repository.

#### Add npmToken to Renovate config

If you are using the main npmjs registry then you can configure just the `npmToken` instead:

```json
{
  "npmToken": "abcdefghi-1234-jklmno-aac6-12345567889"
}
```

#### Add an encrypted npm token to Renovate config

If you don't want all users of the repository to see the unencrypted token, you can encrypt it with Renovate's public key instead, so that only Renovate can decrypt it.

Go to <https://renovatebot.com/encrypt>, paste in your npm token, click "Encrypt", then copy the encrypted result.

Paste the encrypted result inside an `encrypted` object like this:

```json
{
  "encrypted": {
    "npmToken": "xxT19RIdhAh09lkhdrK39HzKNBn3etoLZAwHdeJ25cX+5y52a9kAC7flXmdw5JrkciN08aQuRNqDaKxp53IVptB5AYOnQPrt8MCT+x0zHgp4A1zv1QOV84I6uugdWpFSjPUkmLGMgULudEZJMlY/dAn/IVwf/IImqwazY8eHyJAA4vyUqKkL9SXzHjvS+OBonQ/9/AHYYKmDJwT8vLSRCKrXxJCdUfH7ZnikZbFqjnURJ9nGUHP44rlYJ7PFl05RZ+X5WuZG/A27S5LuBvguyQGcw8A2AZilHSDta9S/4eG6kb22jX87jXTrT6orUkxh2WHI/xvNUEout0gxwWMDkA=="
  }
}
```

If you have no `.npmrc` file then Renovate creates one for you, pointing to the default npmjs registry.
If instead you use an alternative registry or need an `.npmrc` file for some other reason, you should configure it too and substitute the npm token with `${NPM_TOKEN}` for it to be replaced. e.g.

```json
{
  "encrypted": {
    "npmToken": "xxT19RIdhAh09lkhdrK39HzKNBn3etoLZAwHdeJ25cX+5y52a9kAC7flXmdw5JrkciN08aQuRNqDaKxp53IVptB5AYOnQPrt8MCT+x0zHgp4A1zv1QOV84I6uugdWpFSjPUkmLGMgULudEZJMlY/dAn/IVwf/IImqwazY8eHyJAA4vyUqKkL9SXzHjvS+OBonQ/9/AHYYKmDJwT8vLSRCKrXxJCdUfH7ZnikZbFqjnURJ9nGUHP44rlYJ7PFl05RZ+X5WuZG/A27S5LuBvguyQGcw8A2AZilHSDta9S/4eG6kb22jX87jXTrT6orUkxh2WHI/xvNUEout0gxwWMDkA=="
  },
  "npmrc": "registry=https://my.custom.registry/npm\n//my.custom.registry/npm:_authToken=${NPM_TOKEN}"
}
```

Renovate will then use the following logic:

1. If no `npmrc` string is present in config then one will be created with the `_authToken` pointing to the default npmjs registry
1. If an `npmrc` string is present and contains `${NPM_TOKEN}` then that placeholder will be replaced with the decrypted token
1. If an `npmrc` string is present but doesn't contain `${NPM_TOKEN}` then the file will have `_authToken=<token>` appended to it

#### Encrypted entire .npmrc file into config

Copy the entire `.npmrc`, replace newlines with `\n` characters , and then try encrypting it at <https://renovatebot.com/encrypt>.

You will then get an encrypted string that you can substitute into your `renovate.json` instead.
The end-result looks like this:

```json
{
  "encrypted": {
    "npmrc": "WOTWu+jliBtXYz3CU2eI7dDyMIvSJKS2N5PEHZmLB3XKT3vLaaYTGCU6m92Q9FgdaM/q2wLYun2JrTP4GPaW8eGZ3iiG1cm7lgOR5xPnkCzz0DUmSf6Cc/6geeVeSFdJ0zqlEAhdNMyJ4pUW6iQxC3WJKgM/ADvFtme077Acvc0fhCXv0XvbNSbtUwHF/gD6OJ0r2qlIzUMGJk/eI254xo5SwWVctc1iZS9LW+L0/CKjqhWh4SbyglP3lKE5shg3q7mzWDZepa/nJmAnNmXdoVO2aPPeQCG3BKqCtCfvLUUU/0LvnJ2SbQ1obyzL7vhh2OF/VsATS5cxbHvoX/hxWQ=="
  }
}
```

#### Automatically authenticate for npm package stored in private GitHub npm repository

```json
{
  "hostRules": [
    {
      "matchHost": "https://npm.pkg.github.com/",
      "hostType": "npm",
      "encrypted": {
        "token": "<Encrypted PAT Token>"
      }
    }
  ],
  "npmrc": "@organizationName:registry=https://npm.pkg.github.com/"
}
```

#### Yarn 2+

Renovate doesn't support reading `npmRegistries` and `npmScopes` from `.yarnrc.yml`, so `hostRules` (or `npmToken`) and `npmrc` should be configured like above.
Renovate updates `npmRegistries` in `.yarnrc.yml` with resolved `hostRules` before running Yarn.
For Renovate to overwrite existing `npmRegistries` entry, the key should match the `matchHost` minus the protocol (`http:` or `https:`) plus the trailing slash.

For example, the Renovate configuration:

```json
{
  "hostRules": [
    {
      "matchHost": "https://npm.pkg.github.com/",
      "hostType": "npm",
      "encrypted": {
        "token": "<Encrypted PAT Token>"
      }
    }
  ]
}
```

will update `.yarnrc.yml` as following:

```yaml
npmRegistries:
  //npm.pkg.github.com/:
    npmAuthToken: <Decrypted PAT Token>
  //npm.pkg.github.com:
    # this will not be overwritten and may conflict
  https://npm.pkg.github.com/:
    # this will not be overwritten and may conflict
```

### nuget

For each known NuGet registry, Renovate searches for `hostRules` with `hostType=nuget` and matching host.
For those found, a command similar to the following is run: `dotnet nuget add source ${registryInfo.feedUrl} --configfile ${nugetConfigFile} --username ${username} --password ${password} --store-password-in-clear-text`

### poetry

For every poetry source, a `hostRules` search is done and then any found credentials are added to env like `POETRY_HTTP_BASIC_X_USERNAME` and `POETRY_HTTP_BASIC_X_PASSWORD`.

## WhiteSource Renovate Hosted App Encryption

The popular [Renovate App on GitHub](https://github.com/apps/renovate) is hosted by WhiteSource.
If you are a user of this app, and have private modules, then the following is applicable.

### Private presets with public repositories

If you have a preset in a private repo but reference ("extend") it from a public repository then it won't work.
This is because public repositories are provided with a token scoped to only that particular repository, and not for all repositories within the organization.
This is a security measure so that if a the token is accidentally leaked publicly, the damage is limited to the public repository it leaked to and not to every repository within the organization.

The solution to this is that you should break your presets into public and private ones, and reference only the public ones from public repositories.

### Encrypting secrets

It is strongly recommended that you don't commit secrets to repositories, including private ones, and this includes secrets needed by Renovate to access private modules.
Therefore the preferred approach to secrets is that the bot administrator configures them as `hostRules` which are then applied to all repositories which the bot accesses.

If you need to provide credentials to the hosted Renovate App, please do this:

- Encrypt each secret string using <https://app.renovatebot.com/encrypt>. Note: this encrypts using the app's public key fully in the browser and does not send the original secret to any server. You can download this file and perform the encryption fully offline if you like.
- Wrap each secret field in an [encrypted](https://docs.renovatebot.com/configuration-options/#encrypted) object and paste in the encrypted secret value instead. An example is shown below:

```json
{
  "hostRules": [
    {
      "matchHost": "registry.npmjs.org",
      "encrypted": {
        "token": "3f832f2983yf89hsd98ahadsjfasdfjaslf............"
      }
    },
    {
      "matchHost": "https://custom.registry.company.com/pypi/",
      "username": "bot1",
      "encrypted": {
        "password": "p278djfdsi9832jnfdshufwji2r389fdskj........."
      }
    }
  ]
}
```

### Access to GitHub Actions Secrets

The WhiteSource Renovate App does not run using GitHub Actions, but such secrets would be a bad fit for the app anyway for the following reasons:

- The app would be granted access to _all_ the repository/org secrets, not just the ones you want
- If Renovate wants access to such secrets, it would need to ask for them from every user, not just the ones who want to use this approach (GitHub does not support the concept of optional permissions for Apps, so people do not have the option to decline)

## Admin/Bot config vs User/Repository config for Self-hosted users

"Admin/Bot config" refers to the config which the Renovate Bot administrator provides at bot startup, e.g. using environment variables, CLI parameters, or the `config.js` configuration file.
User/Repository config refers to the in-repository config file which defaults to `renovate.json` but has a large number of alternative filenames supported.

If there is a need to supply custom rules for certain repository, it can still be done using the `config.js` file and the `repositories` array.

If per-repository config must be done within the repository, it is still recommended against committing secrets directly (including e.g. `.npmrc` files with tokens) and instead encrypting them with a custom public key first.
For instructions on this, see the above section on encrypting secrets for the WhiteSource Renovate App but instead:

- Save a copy of the <https://app.renovatebot.com/encrypt> HTML file locally, or host it locally
- Generate a public/private key pair for the app using the instructions in [privateKey](https://docs.renovatebot.com/self-hosted-configuration/#privatekey)
- Replace the existing public key in the HTML with the public key you generated in the step prior
- Use the resulting HTML encrypt page to encrypt secrets for your app before adding them to user/repository config
- Configure the app to run with `privateKey` set to the private key you generated above

Note: Encrypted values can't be used in the "Admin/Bot config".

### hostRules configuration using environment variables

Self-hosted users can use environment variables to configure the most common types of `hostRules` for authentication.

The format of the environment variables must follow:

- Datasource name (e.g. `NPM`, `PYPI`)
- Underscore (`_`)
- `matchHost`
- Underscore (`_`)
- Field name (`TOKEN`, `USER_NAME`, or `PASSWORD`)

Hyphens (`-`) in datasource or host name must be replaced with double underscores (`__`).
Periods (`.`) in host names must be replaced with a single underscore (`_`).

Note: the following prefixes cannot be supported for this functionality: `npm_config_`, `npm_lifecycle_`, `npm_package_`.

#### npmjs registry token example

`NPM_REGISTRY_NPMJS_ORG_TOKEN=abc123`:

```json
{
  "hostRules": [
    {
      "hostType": "npm",
      "matchHost": "registry.npmjs.org",
      "token": "abc123"
    }
  ]
}
```

#### GitLab Tags username/password example

`GITLAB__TAGS_CODE__HOST_COMPANY_COM_USERNAME=bot GITLAB__TAGS_CODE__HOST_COMPANY_COM_PASSWORD=botpass123`:

```json
{
  "hostRules": [
    {
      "hostType": "gitlab-tags",
      "matchHost": "code-host.company.com",
      "username": "bot",
      "password": "botpass123"
    }
  ]
}
```

#### Datasource and credentials only

You can skip the host part, and use just the datasource and credentials.

`DOCKER_USERNAME=bot DOCKER_PASSWORD=botpass123`:

```json
{
  "hostRules": [
    {
      "hostType": "docker",
      "username": "bot",
      "password": "botpass123"
    }
  ]
}
```
