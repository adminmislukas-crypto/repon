import { Inject, Injectable } from '@nestjs/common';
import { ProfileNotFoundError } from '../domain/identidad.errors';
import { UsuarioSuspendido } from '../events/usuario-suspendido.event';
import { PROFILE_REPOSITORY, type ProfileRepository } from '../ports-out/profile-repository.port';
import { AUDIT_LOG_PORT, type AuditLogPort } from '../../../shared/audit/audit-log.port';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../../../shared/event-bus/event-publisher.port';
import { TRANSACTION_MANAGER, type TransactionManager } from '../../../shared/database/transaction';

/**
 * `core-api-identidad` spec, "suspenderUsuario / suspenderEmpresa mirror the
 * same pattern". `findById` first supplies both the not-found guard and the
 * audit entry's `cambios.status.antes` — `ProfileRepository.update` is a
 * plain `UPDATE ... WHERE id = :id` that silently affects zero rows on a
 * missing id (no upsert-into-bogus-row risk like `CompanyRepository.save`,
 * but a silent no-op is exactly as wrong: it would still audit-log and
 * publish an event for a mutation that never happened).
 */
@Injectable()
export class SuspenderUsuarioUseCase {
  constructor(
    @Inject(PROFILE_REPOSITORY) private readonly profileRepository: ProfileRepository,
    @Inject(AUDIT_LOG_PORT) private readonly auditLogPort: AuditLogPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
    @Inject(TRANSACTION_MANAGER) private readonly transactionManager: TransactionManager,
  ) {}

  async execute(profileId: string, adminId: string, motivo: string): Promise<void> {
    await this.transactionManager.runInTransaction(async (tx) => {
      const profile = await this.profileRepository.findById(profileId, tx);
      if (!profile) throw new ProfileNotFoundError(profileId);

      const antes = profile.status;
      const despues = 'suspendido' as const;
      await this.profileRepository.update({ ...profile, status: despues }, tx);
      await this.auditLogPort.record(
        {
          actorProfileId: adminId,
          accion: 'suspender_usuario',
          entityType: 'profile',
          entityId: profileId,
          cambios: { status: { antes, despues } },
          motivo,
        },
        tx,
      );
    });

    await this.eventPublisher.publish(new UsuarioSuspendido(profileId, motivo));
  }
}
