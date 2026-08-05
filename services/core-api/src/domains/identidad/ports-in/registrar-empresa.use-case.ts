import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Company } from '@repon/types';
import { createCompany } from '../domain/company.entity';
import { EmpresaRegistrada } from '../events/empresa-registrada.event';
import { COMPANY_REPOSITORY, type CompanyRepository } from '../ports-out/company-repository.port';
import { EVENT_PUBLISHER, type EventPublisher } from '../../../shared/event-bus/event-publisher.port';

export interface RegistrarEmpresaCommand {
  razonSocial: string;
  rut: string;
  giro: string;
}

/**
 * `core-api-identidad` spec, "registrarEmpresa creates only the company
 * row": exactly one `INSERT` into `companies` (`status: 'pendiente'` via
 * `createCompany`'s factory default), never touches `profiles`, never
 * writes `audit_log` (self-service, no admin actor exists at this point —
 * D-C's transaction map lists this use case as "No" transaction, a single
 * insert). `id` is generated here (application-side `randomUUID()`), not by
 * the DB default: `CompanyRepository.save` always supplies an explicit
 * `id`, matching `KyselyCompanyRepository`'s upsert shape (PR 6a).
 */
@Injectable()
export class RegistrarEmpresaUseCase {
  constructor(
    @Inject(COMPANY_REPOSITORY) private readonly companyRepository: CompanyRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisher,
  ) {}

  async execute(command: RegistrarEmpresaCommand): Promise<Company> {
    const company = createCompany({
      id: randomUUID(),
      razonSocial: command.razonSocial,
      rut: command.rut,
      giro: command.giro,
    });

    await this.companyRepository.save(company);
    await this.eventPublisher.publish(new EmpresaRegistrada(company.id));
    return company;
  }
}
