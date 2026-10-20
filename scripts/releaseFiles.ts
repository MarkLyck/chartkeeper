import yaml from 'js-yaml';
import { z } from 'zod';

/** A file CI built, with its sha512 in base64 as latest*.yml lists it. */
export interface BuiltFile {
  name: string;
  size: number;
  sha512: string;
}

/** One update file per platform: installed apps on Windows, Mac and Linux each read their own. */
export const UPDATE_FILES = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml'] as const;

const INSTALLER = /\.(exe|dmg|zip|AppImage|deb)$/;

const UpdateFile = z.object({
  version: z.string(),
  files: z.array(z.object({ url: z.string(), sha512: z.string(), size: z.number() })).min(1),
});

/**
 * What would make the release wrong for installed apps: an update file for another version, a file
 * it lists that isn't the one built, or an installer no update file lists. Empty when it is right.
 */
export function checkReleaseFiles(version: string, files: readonly BuiltFile[], ymls: readonly { name: string; text: string }[]): string[] {
  const problems: string[] = [];
  const built = new Map<string, BuiltFile>();
  for (const f of files) {
    if (built.has(f.name)) problems.push(`${f.name} was built twice`);
    built.set(f.name, f);
  }
  const listed = new Set<string>();
  for (const { name, text } of ymls) {
    let info: z.infer<typeof UpdateFile>;
    try {
      info = UpdateFile.parse(yaml.load(text));
    } catch (e) {
      problems.push(`${name} can't be read: ${(e as Error).message.split('\n')[0]}`);
      continue;
    }
    if (info.version !== version) problems.push(`${name} is for version ${info.version}, not ${version}`);
    for (const f of info.files) {
      listed.add(f.url);
      const b = built.get(f.url);
      if (!b) problems.push(`${name}: ${f.url} is not among the built files`);
      else if (b.size !== f.size) problems.push(`${name}: ${f.url} is ${f.size} bytes, the built file ${b.size}`);
      else if (b.sha512 !== f.sha512) problems.push(`${name}: ${f.url} has another sha512 than the built file`);
    }
  }
  for (const name of UPDATE_FILES) if (!ymls.some((y) => y.name === name)) problems.push(`${name} is missing`);
  for (const name of built.keys()) if (INSTALLER.test(name) && !listed.has(name)) problems.push(`${name} is in no update file`);
  return problems;
}
