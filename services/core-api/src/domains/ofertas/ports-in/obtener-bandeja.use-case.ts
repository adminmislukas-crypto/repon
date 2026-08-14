import { Inject, Injectable } from '@nestjs/common';
import type { Offer } from '@repon/types';
import { OFFER_REPOSITORY, type OfferRepository } from '../ports-out/offer-repository.port';

/**
 * `ofertas/SPEC.md`'s `obtenerBandeja(profileId)` — design.md Diagrama 1,
 * la lectura del usuario: sus propias ofertas, ítems inline (`OfferRepository
 * .findByUser`'s own contract, Phase 3a). Backs `GET /ofertas/bandeja`.
 *
 * ## Constructor: exactly 1 token, NEVER `TRANSACTION_MANAGER`
 *
 * `OFFER_REPOSITORY` only — la misma propiedad estructural (D13) que
 * `ListarSolicitudesElegiblesUseCase` (Phase 4b), inspectable leyendo los
 * metadatos de DI del constructor (tasks.md 7a.8, completa el Scenario "The
 * two read use cases have no transaction manager injected"). Este caso de
 * uso realiza **cero escrituras**: `findByUser` es un único `SELECT` con
 * join a `offer_items` (mismo shape que `save`), sin nada que envolver en
 * una transacción.
 *
 * `profileId` es el ÚNICO input, y siempre viene de `actor.profileId` en el
 * boundary del controller (D11) — este caso de uso no tiene un DTO propio
 * para aceptar uno.
 */
@Injectable()
export class ObtenerBandejaUseCase {
  constructor(@Inject(OFFER_REPOSITORY) private readonly offerRepository: OfferRepository) {}

  async execute(profileId: string): Promise<Offer[]> {
    return this.offerRepository.findByUser(profileId);
  }
}
