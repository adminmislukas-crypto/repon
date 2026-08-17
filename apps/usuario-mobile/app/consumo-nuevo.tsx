import { ScreenStub } from '@/components/ScreenStub';

/** SPEC.md `s-consumo-nuevo` — formulario de nuevo consumo para el usuario
 *  (medicamento/alimento/vacuna/suplemento, campos según tipo). */
export default function ConsumoNuevoScreen() {
  return (
    <ScreenStub
      title="Nuevo medicamento"
      description="Formulario de nuevo consumo — el tipo determina los campos (ver selectPetType() del mockup)."
    />
  );
}
