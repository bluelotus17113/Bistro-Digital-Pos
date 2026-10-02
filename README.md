# Bistro Digital POS

Punto de venta para restaurante. Corre en un computador del local y se usa desde el navegador, tanto en la caja como en los celulares o tablets de los meseros conectados a la misma red wifi. No necesita internet.

## Qué hace

- **Salón:** mesas por zonas, con su estado (libre, con cuenta abierta, pidió la cuenta), el valor acumulado y el tiempo que lleva abierta.
- **Pedidos:** cuenta por mesa o para llevar, búsqueda por nombre o ingrediente, cantidades, notas para cocina, cambio de mesa y anulación con motivo.
- **Cobro:** impuesto (incluido en el precio o sumado), propina voluntaria, descuento en porcentaje o en pesos, pago en efectivo, tarjeta, transferencia o mixto, y cálculo del vuelto.
- **Recibo:** precuenta y recibo en formato de tirilla de 80 mm, listos para imprimir.
- **Ventas:** resumen por rango de fechas, recaudo por método de pago y productos más vendidos.
- **Exportación a Excel:** un libro con las hojas Resumen, Ventas, Detalle, Pagos y Productos.
- **Administración:** menú (categorías y productos), zonas, mesas, datos del negocio, impuesto y propina.

## Cómo usarlo

Requiere [Node.js](https://nodejs.org) 22.13 o superior.

```bash
npm install
npm start
```

Al arrancar muestra dos direcciones: `http://localhost:3000` para el equipo donde corre y la dirección de red local (por ejemplo `http://192.168.1.20:3000`) para abrirlo desde otros dispositivos de la misma wifi.

La primera vez se crea la base de datos con la carta de Bistro Restaurante (53 productos en 10 categorías, con sus ingredientes) y las mesas del local: 9 en el interior y 5 en el exterior. Todo se puede cambiar después en **Menú** y **Ajustes**; la carta inicial está en `server/seed.js`.

Si ya habías arrancado una versión anterior, la carta nueva no reemplaza tu base de datos. Para empezar de cero, detén el servidor y borra la carpeta `data`.

| Variable | Para qué sirve | Valor por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `DB_PATH` | Ubicación de la base de datos | `data/bistro.db` |

## Datos y copias de seguridad

Toda la información queda en el archivo `data/bistro.db` (SQLite). Para hacer una copia de seguridad basta con copiar la carpeta `data` con el servidor detenido.

## Pruebas

```bash
npm test
```

## Notas

- Los valores se manejan en pesos enteros, sin decimales.
- El impuesto y la propina se configuran en **Ajustes**. Vienen con impoconsumo del 8 % incluido en el precio y propina sugerida del 10 %; confirma con tu contador qué aplica a tu negocio.
- El recibo es un comprobante interno: **no es factura electrónica** ni documento equivalente ante la DIAN.
- Esta versión no tiene usuarios ni contraseñas: cualquier dispositivo en la red del local puede usarla. No la expongas a internet.

## Lo que sigue

- Usuarios y roles (mesero, cajero, administrador).
- Apertura y cierre de caja con arqueo.
- Comanda para cocina.
- Dividir la cuenta entre varias personas.
- Inventario y recetas.

Las tipografías incluidas (Bricolage Grotesque y Courier Prime) se distribuyen bajo la licencia SIL Open Font License 1.1.
