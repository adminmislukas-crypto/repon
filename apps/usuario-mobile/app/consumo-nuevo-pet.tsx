import { ScreenStub } from '@/components/ScreenStub';

/** SPEC.md `s-consumo-nuevo-pet` — mismo formulario que `s-consumo-nuevo`,
 *  pero `owner_type: 'pet'`. */
export default function ConsumoNuevoPetScreen() {
  return (
    <ScreenStub
      title="Agregar consumo de mascota"
      description="Mismo formulario que un consumo propio, con owner_type: 'pet'."
    />
  );
}
