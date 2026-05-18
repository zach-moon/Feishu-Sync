import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { toString } from 'mdast-util-to-string';
import type { Root, List, ListItem, Heading, Content } from 'mdast';
import type { ParsedTaskItem } from './types.js';

// ─── Helpers (Task 7.3) ───────────────────────────────────────────────────────

/**
 * Strip outer `**...**` or `__...__` emphasis (one layer only).
 */
export function stripEmphasis(s: string): string {
  const m = s.match(/^\*\*([\s\S]*)\*\*$/) ?? s.match(/^__([\s\S]*)__$/);
  return m ? m[1] : s;
}

/**
 * Regex matching all real Task_Number patterns from sproboagent.
 * Covers: `Task N: ...`, `AZ-2.1 ...`, `23. ...`, `0.1 ...`, `3.8A ...`, `ACSM-1 ...`
 */
export const TASK_NUMBER_RE =
  /^(?:(Task\s+\d+)\s*[:.]\s+|([A-Z][A-Z]*(?:-[A-Z]+)*-)?\d+(?:\.\d+)*[A-Z0-9]*(?:[\.:]\s+|\s+))/;

/**
 * Given stripped+trimmed text (after optional marker removed), returns parsed
 * components or null if no match.
 */
export function extractTaskNumber(
  text: string,
): { taskNumber: string; separator: '.' | ':' | ''; title: string } | null {
  const m = text.match(TASK_NUMBER_RE);
  if (!m) return null;

  const matched = m[0]; // full matched prefix

  // For "Task N:" form, taskNumber is captured in group 1
  if (m[1]) {
    const taskNumber = m[1];
    // Determine separator: look for : or . after "Task N"
    const afterTaskN = text.slice(m[1].length);
    const sepMatch = afterTaskN.match(/^\s*([:.])/)
    const separator: '.' | ':' | '' = sepMatch
      ? (sepMatch[1] as '.' | ':')
      : '';
    const title = text.slice(matched.length).trim();
    return { taskNumber, separator, title };
  }

  // For other forms, taskNumber is the prefix minus trailing separator and whitespace
  const trimmedMatch = matched.trimEnd();
  let separator: '.' | ':' | '' = '';
  let taskNumber = trimmedMatch;

  if (trimmedMatch.endsWith('.')) {
    separator = '.';
    taskNumber = trimmedMatch.slice(0, -1);
  } else if (trimmedMatch.endsWith(':')) {
    separator = ':';
    taskNumber = trimmedMatch.slice(0, -1);
  }

  const title = text.slice(matched.length).trim();
  return { taskNumber, separator, title };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Detect `[-]` or `[ -]` literal prefix in raw cell text.
 * remark-gfm may not recognize `[-]` as a task list checkbox, leaving it as text.
 */
function detectInProgressLiteral(rawCellText: string): {
  isInProgress: boolean;
  rest: string;
} {
  const trimmed = rawCellText.trimStart();
  if (trimmed.startsWith('[-]')) {
    return { isInProgress: true, rest: trimmed.slice(3).trimStart() };
  }
  if (trimmed.startsWith('[ -]')) {
    return { isInProgress: true, rest: trimmed.slice(4).trimStart() };
  }
  return { isInProgress: false, rest: rawCellText };
}

/**
 * Detect optional `*` marker at the beginning of stripped text.
 * Returns whether optional and the text with marker removed.
 */
function detectOptionalMarker(text: string): { optional: boolean; rest: string } {
  // Pattern: starts with `* ` followed by something that could be a task number
  if (text.startsWith('* ')) {
    return { optional: true, rest: text.slice(2) };
  }
  // Pattern: lone `*` immediately before a digit or letter (no space between * and number)
  if (text.startsWith('*') && text.length > 1 && text[1] !== '*') {
    // Check if what follows (after optional space) matches task number
    const afterStar = text.slice(1).trimStart();
    if (TASK_NUMBER_RE.test(afterStar)) {
      return { optional: true, rest: afterStar };
    }
  }
  return { optional: false, rest: text };
}

type ContributorState = 'done' | 'not_started' | 'in_progress';

function aggregateHeadingStatus(contributors: ContributorState[]): {
  status: 'not_started' | 'done' | 'in_progress';
  progress: number;
} {
  if (contributors.length === 0) return { status: 'not_started', progress: 0 };
  const dones = contributors.filter((c) => c === 'done').length;
  const inProgress = contributors.filter((c) => c === 'in_progress').length;
  if (dones === contributors.length) return { status: 'done', progress: 100 };
  if (inProgress === 0 && dones === 0) return { status: 'not_started', progress: 0 };
  // in_progress
  if (dones === 0) return { status: 'in_progress', progress: 1 };
  return {
    status: 'in_progress',
    progress: Math.floor((dones / contributors.length) * 100),
  };
}

// ─── Main parser (Tasks 7.1 + 7.2) ───────────────────────────────────────────

interface InternalTask {
  source: 'list' | 'heading';
  taskNumber: string;
  separator: '.' | ':' | '';
  title: string;
  status: 'not_started' | 'in_progress' | 'done';
  progress: number;
  optional: boolean;
  /** mdast position offset for ordering */
  offset: number;
}

/**
 * Parse a tasks.md file and return all TopLevel_Tasks in document order.
 *
 * When a file uses Heading_Tasks (H3 with task number), checkboxes under those
 * headings are treated as "contributors" to the heading's status — they are NOT
 * independent TopLevel_Tasks. Only checkboxes that appear BEFORE the first
 * Heading_Task (or in files with no Heading_Tasks at all) are treated as List_Tasks.
 */
export function parseTasksFile(text: string): ParsedTaskItem[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text) as Root;

  const headingTasks = collectHeadingTasks(tree);

  let listTasks: InternalTask[];
  if (headingTasks.length > 0) {
    // File uses Heading_Task syntax — only collect List_Tasks that appear
    // BEFORE the first Heading_Task's offset (i.e. top-level checkboxes that
    // precede any H3 task heading).
    const firstHeadingOffset = Math.min(...headingTasks.map(h => h.offset));
    const allListTasks = collectListTasks(tree);
    listTasks = allListTasks.filter(t => t.offset < firstHeadingOffset);
  } else {
    // File uses only List_Task syntax — collect all depth-0 checkboxes
    listTasks = collectListTasks(tree);
  }

  // Merge both in document order (by mdast position offset)
  const all: InternalTask[] = [...listTasks, ...headingTasks].sort(
    (a, b) => a.offset - b.offset,
  );

  // Assign sequential ordinal
  return all.map((t, i) => ({
    ordinal: i + 1,
    source: t.source,
    taskNumber: t.taskNumber,
    separator: t.separator,
    title: t.title,
    status: t.status,
    progress: t.progress,
    optional: t.optional,
  }));
}

// ─── List_Task path (Task 7.1) ────────────────────────────────────────────────

function collectListTasks(tree: Root): InternalTask[] {
  const results: InternalTask[] = [];

  function walkList(list: List, depth: number): void {
    for (const item of list.children) {
      if (item.type !== 'listItem') continue;
      processListItem(item, depth);
      // Recurse into nested lists within this listItem
      for (const child of item.children) {
        if (child.type === 'list') {
          walkList(child as List, depth + 1);
        }
      }
    }
  }

  function processListItem(item: ListItem, depth: number): void {
    // Only process depth-0 items
    if (depth !== 0) return;

    // Get raw text from first paragraph child
    const firstPara = item.children.find((c) => c.type === 'paragraph');
    if (!firstPara) return;

    const rawCellText = toString(firstPara);

    let status: 'not_started' | 'in_progress' | 'done';
    let progress: number;
    let textForParsing: string;

    if (item.checked === true) {
      status = 'done';
      progress = 100;
      textForParsing = rawCellText;
    } else if (item.checked === false) {
      status = 'not_started';
      progress = 0;
      textForParsing = rawCellText;
    } else {
      // checked === null — check for [-] literal
      const detection = detectInProgressLiteral(rawCellText);
      if (!detection.isInProgress) return; // not a task item, skip
      status = 'in_progress';
      progress = 50;
      textForParsing = detection.rest;
    }

    // Strip emphasis, trim
    const stripped = stripEmphasis(textForParsing).trim();

    // Detect optional `*` marker
    const { optional, rest: afterOptional } = detectOptionalMarker(stripped);

    // Match Task_Number regex
    const extracted = extractTaskNumber(afterOptional);
    if (!extracted) return; // not a TopLevel_Task

    const offset = item.position?.start.offset ?? 0;

    results.push({
      source: 'list',
      taskNumber: extracted.taskNumber,
      separator: extracted.separator,
      title: extracted.title,
      status,
      progress,
      optional,
      offset,
    });
  }

  // Walk all root-level lists
  for (const node of tree.children) {
    if (node.type === 'list') {
      walkList(node as List, 0);
    }
  }

  return results;
}

// ─── Heading_Task path (Task 7.2) ─────────────────────────────────────────────

function collectHeadingTasks(tree: Root): InternalTask[] {
  const results: InternalTask[] = [];
  const rootChildren = tree.children;

  for (let i = 0; i < rootChildren.length; i++) {
    const node = rootChildren[i];
    if (node.type !== 'heading' || (node as Heading).depth !== 3) continue;

    const heading = node as Heading;
    const headingText = toString(heading);
    const stripped = stripEmphasis(headingText).trim();

    // Match Task_Number regex
    const extracted = extractTaskNumber(stripped);
    if (!extracted) continue; // not a task heading (e.g. phase/subgroup)

    // Collect contributor listItems between this H3 and next ≤H3 heading (or EOF)
    const contributors = collectContributors(rootChildren, i);

    // If no contributors, this is a Subgroup_Heading — skip
    if (contributors.length === 0) continue;

    // Aggregate status
    const { status, progress } = aggregateHeadingStatus(contributors);

    const offset = heading.position?.start.offset ?? 0;

    results.push({
      source: 'heading',
      taskNumber: extracted.taskNumber,
      separator: extracted.separator,
      title: extracted.title,
      status,
      progress,
      optional: false, // Heading_Task never has optional marker
      offset,
    });
  }

  return results;
}

/**
 * Collect contributor states from listItems between a heading and the next
 * same-or-higher-level heading (or EOF).
 */
function collectContributors(
  rootChildren: Content[],
  headingIndex: number,
): ContributorState[] {
  const contributors: ContributorState[] = [];

  for (let j = headingIndex + 1; j < rootChildren.length; j++) {
    const sibling = rootChildren[j];

    // Stop at next heading with depth <= 3
    if (sibling.type === 'heading' && (sibling as Heading).depth <= 3) break;

    // Only look at root-level lists
    if (sibling.type !== 'list') continue;

    const list = sibling as List;
    for (const item of list.children) {
      if (item.type !== 'listItem') continue;

      if (item.checked === true) {
        contributors.push('done');
      } else if (item.checked === false) {
        contributors.push('not_started');
      } else {
        // checked === null — check for [-] literal
        const firstPara = item.children.find((c) => c.type === 'paragraph');
        if (firstPara) {
          const rawText = toString(firstPara);
          const { isInProgress } = detectInProgressLiteral(rawText);
          if (isInProgress) {
            contributors.push('in_progress');
          }
          // else: plain explanatory bullet, not counted
        }
      }
    }
  }

  return contributors;
}
