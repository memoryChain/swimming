import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const FEATURE_NAME = 'respect_system_proxy';
const FEATURE_LINE = `${FEATURE_NAME} = true`;

function runCodex(args) {
  const command = process.platform === 'win32'
    ? (process.env.ComSpec || 'cmd.exe')
    : 'codex';
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', `codex ${args.join(' ')}`]
    : args;
  return spawnSync(command, commandArgs, {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function hasCodexCommand() {
  if (process.platform === 'win32') {
    const result = spawnSync('where.exe', ['codex.cmd'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return result.status === 0;
  }

  const result = spawnSync('codex', ['--version'], {
    encoding: 'utf8',
  });
  return result.error?.code !== 'ENOENT';
}

function verifyWithCodexCli() {
  if (!hasCodexCommand()) {
    console.log('未在 PATH 中找到 Codex CLI，已跳过命令行版本验证。');
    return;
  }

  const featureList = runCodex(['features', 'list']);
  if (featureList.error || featureList.status !== 0) {
    console.warn(
      `Codex CLI 验证未完成：${featureList.stderr || featureList.error?.message || '未知错误'}`,
    );
    return;
  }

  const featurePattern = new RegExp(`^${FEATURE_NAME}\\s+`, 'm');
  if (!featurePattern.test(featureList.stdout)) {
    console.log(
      `PATH 中的 Codex CLI 版本较旧或与桌面端不同，已跳过功能验证。`,
    );
    return;
  }

  const enabledPattern = new RegExp(`^${FEATURE_NAME}\\s+.*\\btrue\\s*$`, 'm');
  if (!enabledPattern.test(featureList.stdout)) {
    throw new Error(`Codex 没有报告 ${FEATURE_NAME} 已启用。`);
  }

  console.log(`Codex CLI 已确认 ${FEATURE_NAME} 生效。`);
}

function getCodexHome() {
  const configuredHome = process.env.CODEX_HOME?.trim();
  if (!configuredHome) {
    return join(homedir(), '.codex');
  }
  return isAbsolute(configuredHome)
    ? configuredHome
    : resolve(process.cwd(), configuredHome);
}

function replaceBooleanSetting(line, dotted = false) {
  const indent = line.match(/^\s*/)?.[0] ?? '';
  const comment = line.match(/\s+#.*$/)?.[0] ?? '';
  const key = dotted ? `features.${FEATURE_NAME}` : FEATURE_NAME;
  return `${indent}${key} = true${comment}`;
}

function mergeFeatureSetting(original, eol) {
  const hadBom = original.startsWith('\uFEFF');
  const normalized = (hadBom ? original.slice(1) : original)
    .replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }

  const dottedPattern = new RegExp(
    `^\\s*features\\.${FEATURE_NAME}\\s*=`,
  );
  const dottedIndex = lines.findIndex((line) => dottedPattern.test(line));
  if (dottedIndex >= 0) {
    lines[dottedIndex] = replaceBooleanSetting(lines[dottedIndex], true);
  } else {
    const featuresIndex = lines.findIndex((line) => /^\s*\[features\]\s*(?:#.*)?$/.test(line));
    if (featuresIndex >= 0) {
      let sectionEnd = lines.length;
      for (let index = featuresIndex + 1; index < lines.length; index += 1) {
        if (/^\s*\[[^\]]+\]\s*(?:#.*)?$/.test(lines[index])) {
          sectionEnd = index;
          break;
        }
      }

      const settingPattern = new RegExp(`^\\s*${FEATURE_NAME}\\s*=`);
      let settingIndex = -1;
      for (let index = featuresIndex + 1; index < sectionEnd; index += 1) {
        if (settingPattern.test(lines[index])) {
          settingIndex = index;
          break;
        }
      }

      if (settingIndex >= 0) {
        lines[settingIndex] = replaceBooleanSetting(lines[settingIndex]);
      } else {
        lines.splice(featuresIndex + 1, 0, FEATURE_LINE);
      }
    } else {
      if (lines.length > 0 && lines.at(-1).trim() !== '') {
        lines.push('');
      }
      lines.push('[features]', FEATURE_LINE);
    }
  }

  return `${hadBom ? '\uFEFF' : ''}${lines.join(eol)}${eol}`;
}

function enableByEditingConfig() {
  const codexHome = getCodexHome();
  const configPath = join(codexHome, 'config.toml');
  const original = existsSync(configPath)
    ? readFileSync(configPath, 'utf8')
    : '';
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const updated = mergeFeatureSetting(original, eol);

  if (updated !== original) {
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(configPath, updated, 'utf8');
    console.log(`已写入 ${configPath}`);
  } else {
    console.log(`${configPath} 已经包含所需配置。`);
  }
}

try {
  enableByEditingConfig();
  verifyWithCodexCli();
  console.log('配置完成。请完整退出并重新打开 Codex。');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
