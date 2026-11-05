import { Octokit } from '@octokit/core';

/** A GitHub issue reference parsed from a task title. */
export interface GithubIssueRef {
    owner: string;
    repo: string;
    number: number;
    url: string;
}

export interface GithubIssueStatus {
    state: 'open' | 'closed';
    /** True when at least one "blocked by" dependency on GitHub is still open. */
    blockedByUnresolved: boolean;
    fetchedAt: number;
}

export type TaskStatusKey = 'pending' | 'in_progress' | 'blocked' | 'finished';

export const TASK_STATUS_KEYS: readonly TaskStatusKey[] = ['pending', 'in_progress', 'blocked', 'finished'];

export const STATUS_FILTERS: { key: TaskStatusKey, label: string, zhLabel: string }[] = [
    { key: 'pending', label: 'Pending', zhLabel: '待处理' },
    { key: 'in_progress', label: 'In progress', zhLabel: '进行中' },
    { key: 'blocked', label: 'Blocked', zhLabel: '已阻塞' },
    { key: 'finished', label: 'Finished', zhLabel: '已完成' },
];

// Task titles that `por prep` creates issues for end with a link to the issue, e.g.
// "# acquire a #green apple [#12](https://github.com/org/repo/issues/12)".
// Finished tasks are moved into a `_done.md` note by convention.
const DONE_NOTE_NAME = '_done.md';

/** True for notes tasks are moved into once they are done (e.g. `prep/_done.md`). */
export function isDoneNote(path: string): boolean {
    return path === DONE_NOTE_NAME || path.endsWith(`/${DONE_NOTE_NAME}`);
}
const MARKDOWN_ISSUE_LINK = /\[[^\]]*\]\(https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?\)\s*$/;
const BARE_ISSUE_LINK = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?\s*$/;

/** Extracts the GitHub issue a task title ends with, if any. */
export function parseGithubIssueLink(title: string): GithubIssueRef | undefined {
    const trimmed = title.trim();
    const match = trimmed.match(MARKDOWN_ISSUE_LINK) || trimmed.match(BARE_ISSUE_LINK);
    if (!match) return undefined;
    const [, owner, repo, number] = match;
    const issueNumber = Number(number);
    if (!owner || !repo || !Number.isInteger(issueNumber) || issueNumber <= 0) return undefined;
    return { owner, repo, number: issueNumber, url: `https://github.com/${owner}/${repo}/issues/${issueNumber}` };
}

export function githubIssueKey(issue: GithubIssueRef): string {
    return `${issue.owner}/${issue.repo}#${issue.number}`;
}

/**
 * Status algorithm:
 * - no issue link -> Finished when the task lives in a `_done.md` note, Pending otherwise
 * - issue closed -> Finished
 * - issue open and blocked (incoming graph connector or unresolved GitHub "blocked by") -> Blocked
 * - issue open otherwise -> In progress
 * A linked issue whose state could not be fetched (yet) counts as In progress.
 */
export function resolveTaskStatus(
    task: { issue?: GithubIssueRef, path: string },
    issueStatus: GithubIssueStatus | undefined,
    blockedByConnector: boolean,
): TaskStatusKey {
    if (!task.issue) return isDoneNote(task.path) ? 'finished' : 'pending';
    if (!issueStatus) return 'in_progress';
    if (issueStatus.state === 'closed') return 'finished';
    return issueStatus.blockedByUnresolved || blockedByConnector ? 'blocked' : 'in_progress';
}

export class GithubIssueStatusService {
    readonly token: string;
    private readonly octokit: Octokit;
    private readonly statuses = new Map<string, GithubIssueStatus>();
    private refreshRun = Promise.resolve();

    constructor(token = '') {
        this.token = token;
        this.octokit = new Octokit(token ? { auth: token } : {});
    }

    get(key: string): GithubIssueStatus | undefined {
        return this.statuses.get(key);
    }

    /** Refreshes the cached issue states; concurrent calls share a single run. */
    refresh(issues: GithubIssueRef[], maxAgeMs = 10 * 60 * 1000): Promise<void> {
        this.refreshRun = this.refreshRun.then(() => this.run(issues, maxAgeMs))
            .catch(error => console.error('Task graph GitHub issue refresh failed', error));
        return this.refreshRun;
    }

    private async run(issues: GithubIssueRef[], maxAgeMs: number): Promise<void> {
        const now = Date.now();
        const stale: GithubIssueRef[] = [];
        const seen = new Set<string>();
        for (const issue of issues) {
            const key = githubIssueKey(issue);
            if (seen.has(key)) continue;
            seen.add(key);
            const cached = this.statuses.get(key);
            if (!cached || now - cached.fetchedAt > maxAgeMs) stale.push(issue);
        }
        if (!stale.length) return;

        let next = 0;
        const worker = async () => {
            while (next < stale.length) {
                const issue = stale[next++];
                if (!issue) continue;
                try {
                    await this.loadIssue(issue);
                } catch (error) {
                    // Keep any previously cached state; the next refresh retries.
                    console.debug('Task graph could not load GitHub issue', githubIssueKey(issue), error);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, stale.length) }, () => worker()));
    }

    private async loadIssue(issue: GithubIssueRef): Promise<void> {
        const issueResponse = await this.octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}', {
            owner: issue.owner, repo: issue.repo, issue_number: issue.number,
        });
        const state: 'open' | 'closed' = issueResponse.data.state === 'closed' ? 'closed' : 'open';
        let blockedByUnresolved = false;
        if (state === 'open') {
            try {
                const blockedResponse = await this.octokit.request('GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by', {
                    owner: issue.owner, repo: issue.repo, issue_number: issue.number,
                });
                blockedByUnresolved = blockedResponse.data.some(blocker => blocker.state === 'open');
            } catch (error) {
                console.debug('Task graph could not load blocked-by dependencies', githubIssueKey(issue), error);
            }
        }
        this.statuses.set(githubIssueKey(issue), { state, blockedByUnresolved, fetchedAt: Date.now() });
    }
}
