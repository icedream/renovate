import is from '@sindresorhus/is';

import { getOptions } from '../../../../config/options';
import type { AllConfig, RenovateOptions } from '../../../../config/types';
import { PLATFORM_TYPE_GITHUB } from '../../../../constants/platforms';
import { getDatasourceList } from '../../../../datasource';
import { logger } from '../../../../logger';
import type { HostRule } from '../../../../types';

// istanbul ignore if
if (process.env.ENV_PREFIX) {
  for (const [key, val] of Object.entries(process.env)) {
    if (key.startsWith(process.env.ENV_PREFIX)) {
      process.env[key.replace(process.env.ENV_PREFIX, 'RENOVATE_')] = val;
    }
  }
}

export function getEnvName(option: Partial<RenovateOptions>): string {
  if (option.env === false) {
    return '';
  }
  if (option.env) {
    return option.env;
  }
  const nameWithUnderscores = option.name.replace(/([A-Z])/g, '_$1');
  return `RENOVATE_${nameWithUnderscores.toUpperCase()}`;
}

export function getConfig(env: NodeJS.ProcessEnv): AllConfig {
  const options = getOptions();

  let config: AllConfig = {};

  if (env.RENOVATE_CONFIG) {
    try {
      config = JSON.parse(env.RENOVATE_CONFIG);
      logger.debug({ config }, 'Detected config in env RENOVATE_CONFIG');
    } catch (err) /* istanbul ignore next */ {
      logger.fatal({ err }, 'Could not parse RENOVATE_CONFIG');
      process.exit(1);
    }
  }

  config.hostRules ||= [];

  const coersions = {
    boolean: (val: string): boolean => val === 'true',
    array: (val: string): string[] => val.split(',').map((el) => el.trim()),
    string: (val: string): string => val.replace(/\\n/g, '\n'),
    object: (val: string): any => JSON.parse(val),
    integer: parseInt,
  };

  options.forEach((option) => {
    if (option.env !== false) {
      const envName = getEnvName(option);
      if (env[envName]) {
        // istanbul ignore if
        if (option.type === 'array' && option.subType === 'object') {
          try {
            const parsed = JSON.parse(env[envName]);
            if (is.array(parsed)) {
              config[option.name] = parsed;
            } else {
              logger.debug(
                { val: env[envName], envName },
                'Could not parse object array'
              );
            }
          } catch (err) {
            logger.debug({ val: env[envName], envName }, 'Could not parse CLI');
          }
        } else {
          const coerce = coersions[option.type];
          config[option.name] = coerce(env[envName]);
        }
      }
    }
  });

  if (env.GITHUB_COM_TOKEN) {
    logger.debug(`Converting GITHUB_COM_TOKEN into a global host rule`);
    config.hostRules.push({
      hostType: PLATFORM_TYPE_GITHUB,
      matchHost: 'github.com',
      token: env.GITHUB_COM_TOKEN,
    });
  }

  const datasources = new Set(getDatasourceList());
  const fields = ['token', 'username', 'password'];

  const hostRules: HostRule[] = [];

  const npmEnvPrefixes = ['npm_config_', 'npm_lifecycle_', 'npm_package_'];

  for (const envName of Object.keys(env).sort()) {
    if (npmEnvPrefixes.some((prefix) => envName.startsWith(prefix))) {
      logger.trace('Ignoring npm env: ' + envName);
      continue; // eslint-disable-line no-continue
    }
    // Double underscore __ is used in place of hyphen -
    const splitEnv = envName.toLowerCase().replace(/__/g, '-').split('_');
    const hostType = splitEnv.shift();
    if (datasources.has(hostType)) {
      const suffix = splitEnv.pop();
      if (fields.includes(suffix)) {
        let matchHost: string;
        const rule: HostRule = {};
        rule[suffix] = env[envName];
        if (splitEnv.length === 0) {
          // host-less rule
        } else if (splitEnv.length === 1) {
          logger.warn(`Cannot parse ${envName} env`);
          continue; // eslint-disable-line no-continue
        } else {
          matchHost = splitEnv.join('.');
        }
        const existingRule = hostRules.find(
          (hr) => hr.hostType === hostType && hr.matchHost === matchHost
        );
        logger.debug(`Converting ${envName} into a global host rule`);
        if (existingRule) {
          // Add current field to existing rule
          existingRule[suffix] = env[envName];
        } else {
          // Create a new rule
          const newRule: HostRule = {
            hostType,
          };
          if (matchHost) {
            newRule.matchHost = matchHost;
          }
          newRule[suffix] = env[envName];
          hostRules.push(newRule);
        }
      }
    }
  }

  config.hostRules = [...config.hostRules, ...hostRules];

  // These env vars are deprecated and deleted to make sure they're not used
  const unsupportedEnv = [
    'BITBUCKET_TOKEN',
    'BITBUCKET_USERNAME',
    'BITBUCKET_PASSWORD',
    'GITHUB_ENDPOINT',
    'GITHUB_TOKEN',
    'GITLAB_ENDPOINT',
    'GITLAB_TOKEN',
    'VSTS_ENDPOINT',
    'VSTS_TOKEN',
  ];
  // eslint-disable-next-line no-param-reassign
  unsupportedEnv.forEach((val) => delete env[val]);

  return config;
}
