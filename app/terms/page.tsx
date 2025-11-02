"use client";

export default function TermsPage() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6">
      <div className="w-full max-w-2xl text-white">
        <h1 className="text-2xl font-semibold mb-4">Términos y Condiciones</h1>
        <p className="text-sm text-gray-300 mb-4">
          Última actualización: {new Date().toLocaleDateString()}
        </p>

        <div className="space-y-4 text-sm leading-relaxed text-gray-200">
          <p>
            Este servicio es operado por un agente de inteligencia artificial experimental
            que asiste en la selección y gestión de pedidos en una máquina expendedora.
            El sistema puede cometer errores, interpretar de forma imprecisa tus mensajes
            o presentar información desactualizada. Al usar el servicio, aceptás estos
            riesgos y limitaciones.
          </p>

          <h2 className="text-lg font-medium text-white mt-6">Uso del servicio</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              Confirmar el producto y el <span className="font-medium">monto a pagar</span> es responsabilidad del usuario
              antes de realizar el pago. Verificá que el importe mostrado coincida con lo que vas a abonar.
            </li>
            <li>
              El proceso de pago se realiza a través de terceros. Pueden aplicar términos
              adicionales de esos proveedores.
            </li>
            <li>
              Usá el servicio de forma lícita y respetuosa. Podemos limitar o suspender el acceso
              ante usos indebidos o intentos de manipulación del sistema.
            </li>
          </ul>

          <h2 className="text-lg font-medium text-white mt-6">Expendio y responsabilidad</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              No garantizamos disponibilidad continua de productos ni funcionamiento ininterrumpido de la máquina.
            </li>
            <li>
              <span className="font-medium">No realizamos reembolsos</span> por productos que <span className="font-medium">no fueron efectivamente expendidos</span>
              por causas ajenas a nuestro control (por ejemplo: atascos, cortes de energía, falta de producto, fallas de hardware del equipo, conectividad, etc.).
            </li>
            <li>
              En caso de inconvenientes, podés contactarte a través de los canales indicados en la máquina;
              haremos esfuerzos razonables para ayudarte, sin asumir obligaciones de compensación económica.
            </li>
          </ul>

          <h2 className="text-lg font-medium text-white mt-6">Contenido generado por IA</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              Las respuestas del asistente pueden ser incompletas o incorrectas. No constituyen asesoramiento profesional.
            </li>
            <li>
              Evitá compartir datos sensibles. El uso de la información brindada es bajo tu exclusiva responsabilidad.
            </li>
          </ul>

          <h2 className="text-lg font-medium text-white mt-6">Pagos</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>
              Verificá el importe, el producto y la máquina antes de pagar. Una vez iniciado el pago, es posible que no pueda cancelarse.
            </li>
            <li>
              Los tiempos de acreditación pueden variar según el proveedor de pagos.
            </li>
          </ul>

          <h2 className="text-lg font-medium text-white mt-6">Limitación de responsabilidad</h2>
          <p>
            En la máxima medida permitida por ley, el servicio se ofrece “tal cual” y “según disponibilidad”.
            No asumimos responsabilidades por daños indirectos, incidentales, especiales, punitivos o consecuentes,
            ni por pérdida de datos, ganancias o ingresos, derivados del uso o imposibilidad de uso del servicio.
          </p>

          <h2 className="text-lg font-medium text-white mt-6">Cambios</h2>
          <p>
            Podemos actualizar estos Términos y Condiciones en cualquier momento. Los cambios entran en vigor
            al publicarse en esta página. El uso continuado del servicio implica aceptación de las versiones actualizadas.
          </p>

          <p className="mt-6 text-gray-300">
            Si no estás de acuerdo con estos términos, por favor no uses el servicio.
          </p>
        </div>
      </div>
    </div>
  );
}


