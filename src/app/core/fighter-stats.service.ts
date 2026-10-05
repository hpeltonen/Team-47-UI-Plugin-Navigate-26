import { inject, Injectable } from '@angular/core';
import { Index, QueryType, SearchService } from '@sailpoint/angular-sdk/search';
import { LifecycleStatesService, type LifecycleState } from '@sailpoint/angular-sdk/lifecycle_states';
import { firstValueFrom } from 'rxjs';

/**
 * What the Search identities index tells us about one person, reduced to the
 * handful of numbers the arena turns into health, armour and weapons.
 */
export interface IdentityCombatProfile {
  id: string;
  name: string;
  email: string;
  entitlementCount: number;
  roleCount: number;
  accessProfileCount: number;
  privilegedCount: number;
  accountCount: number;
  lifecycleState: string;
  identityProfileId: string;
  identityProfileName: string;
}

/** Shape of the fields we read from a Search identity document. */
interface IdentitySearchDoc {
  id?: string;
  name?: string;
  displayName?: string;
  email?: string;
  entitlementCount?: number;
  roleCount?: number;
  accessProfileCount?: number;
  accessCount?: number;
  accounts?: unknown[];
  access?: Array<{ type?: string; privileged?: boolean }>;
  identityProfile?: { id?: string; name?: string };
  attributes?: { cloudLifecycleState?: string };
}

@Injectable({ providedIn: 'root' })
export class FighterStatsService {
  private readonly search = inject(SearchService);
  private readonly lifecycle = inject(LifecycleStatesService);

  /** One Search call: the identity document carries every count the arena needs. */
  async combatProfile(identityId: string): Promise<IdentityCombatProfile> {
    const rows = (await firstValueFrom(
      this.search.searchPostV1({
        limit: 1,
        search: {
          indices: [Index.Identities],
          queryType: QueryType.Sailpoint,
          query: { query: `id:"${identityId}"` },
          includeNested: true,
          queryResultFilter: {
            includes: [
              'id',
              'name',
              'displayName',
              'email',
              'entitlementCount',
              'roleCount',
              'accessProfileCount',
              'accessCount',
              'accounts',
              'access',
              'identityProfile',
              'attributes.cloudLifecycleState',
            ],
          },
        },
      }),
    )) as IdentitySearchDoc[];

    const doc = rows[0];
    if (!doc) {
      throw new Error(`Search returned no identity document for ${identityId}`);
    }

    const access = doc.access ?? [];
    const privilegedCount = access.filter((a) => a.privileged === true).length;

    return {
      id: doc.id ?? identityId,
      name: doc.displayName || doc.name || 'Unknown',
      email: doc.email ?? '',
      entitlementCount: doc.entitlementCount ?? access.filter((a) => a.type === 'ENTITLEMENT').length,
      roleCount: doc.roleCount ?? access.filter((a) => a.type === 'ROLE').length,
      accessProfileCount: doc.accessProfileCount ?? access.filter((a) => a.type === 'ACCESS_PROFILE').length,
      privilegedCount,
      accountCount: doc.accounts?.length ?? 0,
      lifecycleState: doc.attributes?.cloudLifecycleState ?? '',
      identityProfileId: doc.identityProfile?.id ?? '',
      identityProfileName: doc.identityProfile?.name ?? '',
    };
  }

  /**
   * Every lifecycle state configured on the identity profile the report belongs
   * to, disabled ones included. Only enabled states can be assigned, but the
   * page shows the disabled ones so an admin knows which switch to flip.
   */
  async lifecycleStates(identityProfileId: string): Promise<LifecycleState[]> {
    return firstValueFrom(
      this.lifecycle.getLifecycleStatesV1({ identityProfileId, limit: 50, sorters: 'priority' }),
    );
  }

  /**
   * The final blow. Moves the identity to the chosen lifecycle state, which is
   * what actually disables accounts and strips access in Identity Security Cloud.
   * Returns the account activity id ISC hands back so the result can be traced.
   */
  async setLifecycleState(identityId: string, lifecycleStateId: string): Promise<string> {
    const res = await firstValueFrom(
      this.lifecycle.setLifecycleStateV1({
        identityId,
        setLifecycleStateV1Request: { lifecycleStateId },
      }),
    );
    return res.accountActivityId ?? '';
  }

  /**
   * Picks the state that best reads as "terminated". Falls back to the lowest
   * priority state that is not the current one.
   */
  pickTerminationState(states: LifecycleState[], currentTechnicalName: string): LifecycleState | null {
    const candidates = states.filter((s) => s.enabled !== false && s.technicalName !== currentTechnicalName);
    const byName = candidates.find((s) => /terminat|offboard|leaver|inactive|disabled|separat/i.test(`${s.name} ${s.technicalName}`));
    if (byName) {
      return byName;
    }
    const inactive = candidates.find((s) => s.identityState && s.identityState !== 'ACTIVE');
    return inactive ?? candidates[candidates.length - 1] ?? null;
  }
}
