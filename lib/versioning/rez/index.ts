import { api as npm } from '../npm';
import { api as pep440 } from '../pep440';
import type { NewValueConfig, VersioningApi } from '../types';
import {
  ascendingRange,
  descendingRange,
  exactVersion,
  inclusiveBound,
  lowerBound,
  upperBound,
  versionGroup,
} from './pattern';
import {
  npm2rezplus,
  padZeroes,
  pep4402rezInclusiveBound,
  rez2npm,
  rez2pep440,
} from './transform';

export const id = 'rez';
export const displayName = 'rez';
export const urls = ['https://github.com/nerdvegas/rez'];
export const supportsRanges = true;
export const supportedRangeStrategies = ['bump', 'extend', 'pin', 'replace'];

function equals(a: string, b: string): boolean {
  try {
    return npm.equals(padZeroes(a), padZeroes(b));
  } catch (err) /* istanbul ignore next */ {
    return pep440.equals(a, b);
  }
}

function getMajor(version: string): number {
  try {
    return npm.getMajor(padZeroes(version));
  } catch (err) /* istanbul ignore next */ {
    return pep440.getMajor(version);
  }
}

function getMinor(version: string): number {
  try {
    return npm.getMinor(padZeroes(version));
  } catch (err) /* istanbul ignore next */ {
    return pep440.getMinor(version);
  }
}

function getPatch(version: string): number {
  try {
    return npm.getPatch(padZeroes(version));
  } catch (err) /* istanbul ignore next */ {
    return pep440.getPatch(version);
  }
}

function isGreaterThan(a: string, b: string): boolean {
  try {
    return npm.isGreaterThan(padZeroes(a), padZeroes(b));
  } catch (err) /* istanbul ignore next */ {
    return pep440.isGreaterThan(a, b);
  }
}

function isLessThanRange(version: string, range: string): boolean {
  return (
    npm.isVersion(padZeroes(version)) &&
    npm.isLessThanRange(padZeroes(version), rez2npm(range))
  );
}

export function isValid(input: string): string | boolean {
  return npm.isValid(rez2npm(input));
}

function isStable(version: string): boolean {
  return npm.isStable(padZeroes(version));
}

function isVersion(input: string): string | boolean {
  return npm.isVersion(padZeroes(rez2npm(input)));
}

function matches(version: string, range: string): boolean {
  return (
    npm.isVersion(padZeroes(version)) &&
    npm.matches(padZeroes(version), rez2npm(range))
  );
}

function getSatisfyingVersion(versions: string[], range: string): string {
  return npm.getSatisfyingVersion(versions, rez2npm(range));
}

function minSatisfyingVersion(versions: string[], range: string): string {
  return npm.minSatisfyingVersion(versions, rez2npm(range));
}

function isSingleVersion(constraint: string): string | boolean {
  return (
    (constraint.trim().startsWith('==') &&
      isVersion(constraint.trim().substring(2).trim())) ||
    isVersion(constraint.trim())
  );
}

function sortVersions(a: string, b: string): number {
  return npm.sortVersions(padZeroes(a), padZeroes(b));
}

function getNewValue({
  currentValue,
  rangeStrategy,
  currentVersion,
  newVersion,
}: NewValueConfig): string {
  const pep440Value = pep440.getNewValue({
    currentValue: rez2pep440(currentValue),
    rangeStrategy,
    currentVersion,
    newVersion,
  });
  if (exactVersion.test(currentValue)) {
    return pep440Value;
  }
  if (inclusiveBound.test(currentValue)) {
    return pep4402rezInclusiveBound(pep440Value);
  }
  if (lowerBound.test(currentValue)) {
    if (currentValue.includes('+')) {
      return npm2rezplus(pep440Value);
    }
    return pep440Value;
  }
  if (upperBound.test(currentValue)) {
    return pep440Value;
  }
  if (ascendingRange.test(currentValue)) {
    // Replace version numbers but keep rez format, otherwise we just end up trying
    // to convert every single case separately.
    const match = ascendingRange.exec(currentValue);
    const lowerBoundAscCurrent = match.groups.range_lower_asc;
    const upperBoundAscCurrent = match.groups.range_upper_asc;
    const lowerAscVersionCurrent = match.groups.range_lower_asc_version;
    const upperAscVersionCurrent = match.groups.range_upper_asc_version;
    const [lowerBoundAscPep440, upperBoundAscPep440] = pep440Value.split(', ');
    const lowerAscVersionNew = new RegExp(versionGroup).exec(
      lowerBoundAscPep440
    )[0];
    const upperAscVersionNew = new RegExp(versionGroup).exec(
      upperBoundAscPep440
    )[0];
    const lowerBoundAscNew = lowerBoundAscCurrent.replace(
      lowerAscVersionCurrent,
      lowerAscVersionNew
    );
    const upperBoundAscNew = upperBoundAscCurrent.replace(
      upperAscVersionCurrent,
      upperAscVersionNew
    );
    const separator = currentValue.includes(',') ? ',' : '';

    return lowerBoundAscNew + separator + upperBoundAscNew;
  }
  if (descendingRange.test(currentValue)) {
    // Replace version numbers but keep rez format, otherwise we just end up trying
    // to convert every single case separately.
    const match = descendingRange.exec(currentValue);
    const upperBoundDescCurrent = match.groups.range_upper_desc;
    const lowerBoundDescCurrent = match.groups.range_lower_desc;
    const upperDescVersionCurrent = match.groups.range_upper_desc_version;
    const lowerDescVersionCurrent = match.groups.range_lower_desc_version;
    const [lowerBoundDescPep440, upperBoundDescPep440] =
      pep440Value.split(', ');

    const upperDescVersionNew = new RegExp(versionGroup).exec(
      upperBoundDescPep440
    )[0];
    const lowerDescVersionNew = new RegExp(versionGroup).exec(
      lowerBoundDescPep440
    )[0];
    const upperBoundDescNew = upperBoundDescCurrent.replace(
      upperDescVersionCurrent,
      upperDescVersionNew
    );
    const lowerBoundDescNew = lowerBoundDescCurrent.replace(
      lowerDescVersionCurrent,
      lowerDescVersionNew
    );
    // Descending ranges are only supported with a comma.
    const separator = ',';

    return upperBoundDescNew + separator + lowerBoundDescNew;
  }
  return null;
}

export const api: VersioningApi = {
  equals,
  getMajor,
  getMinor,
  getPatch,
  getNewValue,
  getSatisfyingVersion,
  isCompatible: isVersion,
  isGreaterThan,
  isLessThanRange,
  isSingleVersion,
  isStable,
  isValid,
  isVersion,
  matches,
  minSatisfyingVersion,
  sortVersions,
};
export default api;
