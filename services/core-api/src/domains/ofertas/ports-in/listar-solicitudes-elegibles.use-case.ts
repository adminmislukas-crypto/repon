import { Inject, Injectable } from '@nestjs/common';
import type { SolicitudElegible } from '@repon/types';
import {
  OFFER_OPPORTUNITY_REPOSITORY,
  type OfferOpportunityRepository,
} from '../ports-out/offer-opportunity-repository.port';

/**
 * `ofertas/SPEC.md`'s `listarSolicitudesElegibles(companyId)` — design.md
 * Diagrama 3, "la lectura, y lo que NO devuelve". Backs `GET
 * /ofertas/oportunidades`.
 *
 * ## Constructor: exactly 1 token, NEVER `TRANSACTION_MANAGER`
 *
 * `OFFER_OPPORTUNITY_REPOSITORY` only — a structural property (D13),
 * inspectable by reading the constructor's DI metadata (tasks.md 4b.1,
 * mirrored on `BuscarProveedoresCompatiblesUseCase`/
 * `ProcesarConsumosVencidosUseCase`). This use case performs **zero
 * writes**: `listarPorCompany` is a single `SELECT` with 2 joins
 * (design.md Diagrama 3), and there is nothing to wrap in a transaction.
 * `obtenerBandeja` (Phase 7a) is the other read use case with this same
 * structural guarantee.
 *
 * `companyId` is the ONLY input, and it always comes from `actor.companyId`
 * at the controller boundary — this use case has no DTO of its own to
 * accept one (D11).
 */
@Injectable()
export class ListarSolicitudesElegiblesUseCase {
  constructor(
    @Inject(OFFER_OPPORTUNITY_REPOSITORY)
    private readonly offerOpportunityRepository: OfferOpportunityRepository,
  ) {}

  async execute(companyId: string): Promise<SolicitudElegible[]> {
    return this.offerOpportunityRepository.listarPorCompany(companyId);
  }
}
