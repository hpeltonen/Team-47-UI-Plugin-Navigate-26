import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SailpointPluginService } from '@core';
import { FighterStatsService, type IdentityCombatProfile } from '@core/fighter-stats.service';
import { Paginator } from '@sailpoint/angular-sdk';
import { IdentitiesService, type Identity } from '@sailpoint/angular-sdk/identities';
import { LifecycleStatesService, type LifecycleState } from '@sailpoint/angular-sdk/lifecycle_states';
import { SearchService } from '@sailpoint/angular-sdk/search';
import { AvatarModule } from 'primeng/avatar';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { firstValueFrom } from 'rxjs';
import { ArenaComponent } from './arena/arena.component';
import type { FighterStats, Outcome } from './arena/game';

/** One entry in the manager dropdown. */
interface ManagerOption {
  id: string;
  name: string;
}

/** Everything loaded for a bout before the bell rings. */
interface Bout {
  manager: FighterStats;
  report: FighterStats;
  reportProfile: IdentityCombatProfile;
  states: LifecycleState[];
}

type Phase = 'pick' | 'loading' | 'prefight' | 'fight' | 'result';

@Component({
  selector: 'app-root',
  imports: [
    ArenaComponent,
    AvatarModule,
    ButtonModule,
    FormsModule,
    MessageModule,
    SelectModule,
    SkeletonModule,
    TableModule,
    TagModule,
  ],
  providers: [IdentitiesService, SearchService, LifecycleStatesService],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly plugin = inject(SailpointPluginService);
  private readonly identitiesSvc = inject(IdentitiesService);
  private readonly stats = inject(FighterStatsService);

  /** Every identity the page has loaded. Everything else is derived from this. */
  protected readonly identities = signal<Identity[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  /** The manager the user picked in the dropdown. */
  protected readonly selectedManagerId = signal('');

  protected readonly phase = signal<Phase>('pick');
  protected readonly bout = signal<Bout | null>(null);
  protected readonly targetStateId = signal('');
  protected readonly outcome = signal<Outcome>(null);
  /** Result of the lifecycle state call after a win. */
  protected readonly termination = signal<{ ok: boolean; message: string; activityId: string } | null>(null);
  protected readonly terminating = signal(false);
  /** Lets a rematch re-create the arena even with identical stats. */
  protected readonly roundKey = signal(0);

  protected readonly managers = computed<ManagerOption[]>(() => {
    const byId = new Map<string, ManagerOption>();
    for (const identity of this.identities()) {
      const ref = identity.managerRef;
      if (ref?.id && ref.name) {
        byId.set(ref.id, { id: ref.id, name: ref.name });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  /** The direct reports of the selected manager. */
  protected readonly reports = computed<Identity[]>(() => {
    const managerId = this.selectedManagerId();
    if (!managerId) {
      return [];
    }
    return this.identities().filter((identity) => identity.managerRef?.id === managerId);
  });

  protected readonly selectedManager = computed(() =>
    this.identities().find((i) => i.id === this.selectedManagerId()) ?? null,
  );

  /** Dropdown options for the lifecycle state picker. */
  protected readonly stateOptions = computed(() =>
    (this.bout()?.states ?? [])
      .filter((s) => s.enabled !== false)
      .map((s) => ({ id: s.id ?? '', label: this.stateLabel(s) })),
  );

  /** States that exist on the profile but are switched off, so nobody can be moved into them yet. */
  protected readonly disabledStates = computed(() =>
    (this.bout()?.states ?? []).filter((s) => s.enabled === false),
  );

  /** True when the only assignable state is the one the report is already in. */
  protected readonly nowhereToGo = computed(() => {
    const b = this.bout();
    if (!b) return false;
    return !b.states.some((s) => s.enabled !== false && s.technicalName !== b.reportProfile.lifecycleState);
  });

  protected readonly targetState = computed(() =>
    this.bout()?.states.find((s) => s.id === this.targetStateId()) ?? null,
  );

  /** True when there is no tenant behind us, so the arena runs with made-up fighters. */
  protected readonly practiceOnly = computed(() => this.plugin.status() === 'failed');

  private requested = false;

  constructor() {
    effect(() => {
      if (this.plugin.apiReady() && !this.requested) {
        this.requested = true;
        void this.loadIdentities();
      }
    });

    // Default the dropdown to the signed-in user when they manage anyone.
    effect(() => {
      const me = this.plugin.user()?.id;
      if (me && !this.selectedManagerId() && this.managers().some((m) => m.id === me)) {
        this.selectedManagerId.set(me);
      }
    });
  }

  protected async loadIdentities(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const identities = await firstValueFrom(
        Paginator.paginate((params) => this.identitiesSvc.listIdentitiesV1(params), { sorters: 'name' }),
      );
      this.identities.set(identities);
    } catch (err) {
      this.error.set(this.formatApiError(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected onManagerChange(managerId: string | null): void {
    this.selectedManagerId.set(managerId ?? '');
    this.backToPick();
  }

  /** Loads both combat profiles and the report's lifecycle states, then shows the tale of the tape. */
  protected async challenge(report: Identity): Promise<void> {
    const managerId = this.selectedManagerId();
    if (!managerId || !report.id) {
      return;
    }
    this.phase.set('loading');
    this.error.set('');
    this.termination.set(null);
    this.outcome.set(null);

    try {
      const [managerProfile, reportProfile] = await Promise.all([
        this.stats.combatProfile(managerId),
        this.stats.combatProfile(report.id),
      ]);
      const states = reportProfile.identityProfileId
        ? await this.stats.lifecycleStates(reportProfile.identityProfileId)
        : [];

      const managerFighter = this.toFighter(managerProfile, this.reports().length);
      const reportFighter = this.toFighter(reportProfile, this.identities().filter((i) => i.managerRef?.id === report.id).length);

      this.bout.set({ manager: managerFighter, report: reportFighter, reportProfile, states });
      const pick = this.stats.pickTerminationState(states, reportProfile.lifecycleState);
      this.targetStateId.set(pick?.id ?? '');
      this.phase.set('prefight');
    } catch (err) {
      this.error.set(this.formatApiError(err));
      this.phase.set('pick');
    }
  }

  /** Lets you tune the fight without a tenant. Used when the handshake failed. */
  protected practiceFight(): void {
    const manager: FighterStats = {
      id: 'practice-manager',
      name: 'Pat Manager',
      seed: 'pat.manager@example.com',
      entitlementCount: 30,
      roleCount: 3,
      privilegedCount: 5,
      directReports: 6,
      subtitle: '30 entitlements · 3 roles · 5 privileged',
      entitlementNames: ['Domain Admins', 'Salesforce Admin', 'AWS PowerUser', 'Okta Super Admin', 'GitHub Owner', 'Payroll Approver'],
    };
    const report: FighterStats = {
      id: 'practice-report',
      name: 'Sam Report',
      seed: 'sam.report@example.com',
      entitlementCount: 22,
      roleCount: 2,
      privilegedCount: 1,
      directReports: 0,
      subtitle: '22 entitlements · 2 roles · 1 privileged',
      entitlementNames: ['Slack Member', 'Jira Developer', 'VPN Users', 'Confluence Editor', 'Workday Employee', 'Zoom Licensed', 'Dropbox Team'],
    };
    this.bout.set({
      manager,
      report,
      reportProfile: {
        id: report.id, name: report.name, email: report.seed, entitlementCount: 22, roleCount: 2,
        accessProfileCount: 1, privilegedCount: 1, accountCount: 4, lifecycleState: 'active',
        identityProfileId: '', identityProfileName: 'Practice', entitlementNames: report.entitlementNames,
      },
      states: [],
    });
    this.targetStateId.set('');
    this.termination.set(null);
    this.outcome.set(null);
    this.startFight();
  }

  protected startFight(): void {
    this.roundKey.update((k) => k + 1);
    this.phase.set('fight');
  }

  /** The arena reports the winner. A manager win fires the real lifecycle state change. */
  protected async onFightEnded(winner: Outcome): Promise<void> {
    this.outcome.set(winner);
    this.phase.set('result');
    const bout = this.bout();
    const state = this.targetState();
    if (winner !== 'manager' || !bout) {
      return;
    }
    if (!state?.id) {
      this.termination.set({
        ok: false,
        activityId: '',
        message: bout.states.length
          ? 'No target lifecycle state was chosen, so nothing was changed.'
          : 'Practice bout: no tenant call was made.',
      });
      return;
    }

    this.terminating.set(true);
    try {
      const activityId = await this.stats.setLifecycleState(bout.reportProfile.id, state.id);
      this.termination.set({
        ok: true,
        activityId,
        message: `${bout.report.name} moved from "${bout.reportProfile.lifecycleState || 'unknown'}" to "${state.name ?? state.technicalName}".`,
      });
      // Reflect the new state in the loaded list so the table shows it immediately.
      this.identities.update((list) =>
        list.map((i) =>
          i.id === bout.reportProfile.id
            ? { ...i, lifecycleState: { stateName: state.technicalName, manuallyUpdated: true } }
            : i,
        ),
      );
    } catch (err) {
      this.termination.set({ ok: false, activityId: '', message: this.formatApiError(err) });
    } finally {
      this.terminating.set(false);
    }
  }

  protected rematch(): void {
    this.termination.set(null);
    this.outcome.set(null);
    this.startFight();
  }

  protected backToPick(): void {
    this.phase.set('pick');
    this.bout.set(null);
    this.outcome.set(null);
    this.termination.set(null);
  }

  private toFighter(p: IdentityCombatProfile, directReports: number): FighterStats {
    return {
      id: p.id,
      name: p.name,
      seed: p.email || p.name,
      entitlementCount: p.entitlementCount,
      roleCount: p.roleCount,
      privilegedCount: p.privilegedCount,
      directReports,
      subtitle: `${p.entitlementCount} entitlements · ${p.roleCount} roles · ${p.privilegedCount} privileged`,
      entitlementNames: p.entitlementNames,
    };
  }

  /** Reads one identity attribute out of the untyped attributes map. */
  protected attr(identity: Identity, key: string): string {
    const attributes = identity.attributes as Record<string, unknown> | undefined;
    const value = attributes?.[key];
    return typeof value === 'string' && value ? value : '-';
  }

  protected lifecycle(identity: Identity): string {
    return identity.lifecycleState?.stateName || this.attr(identity, 'cloudLifecycleState');
  }

  /** Initials for the avatar, so "Jean Bartik" becomes "JB". */
  protected initials(name: string): string {
    return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
  }

  protected stateLabel(s: LifecycleState): string {
    return s.name ? `${s.name} (${s.technicalName})` : s.technicalName;
  }

  private formatApiError(err: unknown): string {
    if (err && typeof err === 'object' && 'error' in err) {
      const body = (err as { error?: { messages?: Array<{ text?: string }>; detailCode?: string } }).error;
      const text = body?.messages?.[0]?.text;
      if (text) {
        return body?.detailCode ? `${body.detailCode}: ${text}` : text;
      }
    }
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }
}
