'use strict';

// Carta de Bistro Restaurante (Ibagué). Solo se carga al crear la base de datos por primera vez;
// después el menú se administra desde la aplicación.
// Formato de cada producto: [nombre, precio en pesos, descripción].
// Los nombres llevan el tipo de plato ("Hamburguesa Tropical", "Perro Tropical") porque varias
// secciones repiten nombre y en la cuenta y el recibo deben distinguirse.

const MENU = [
  ['Hamburguesas', [
    ['Hamburguesa Clásica', 14000, '100 % carne de res, queso, vegetales'],
    ['Hamburguesa Tropical', 20000, '100 % carne de res, chips de papa, jamón, piña melada, queso, vegetales'],
    ['Hamburguesa Carnívora', 20000, '100 % carne de res, queso, vegetales, carne en trozos, jamón'],
    ['Hamburguesa Ranchera', 20000, '100 % carne de res, salchicha, jamón, maíz, queso, vegetales'],
    ['Hamburguesa Costiburquer', 23000, '100 % carne de res, queso, vegetales, costilla en trozos, tocineta'],
    ['Hamburguesa La Quesuda', 23000, '100 % carne de res, tocineta, 3 tipos de quesos, vegetales'],
    ['Hamburguesa Ranchees', 23000, '100 % carne de res, 2 tipos de quesos, vegetales, salchicha, tocineta'],
    ['Hamburguesa Mixta Asada', 24000, '100 % pechuga asada, carne de res, queso, vegetales, jamón, tocineta'],
    ['Hamburguesa Mixta Crispy', 25500, '100 % pechuga crispy, carne de res, queso, vegetales, jamón, tocineta'],
    ['Hamburguesa Paro Cardiaco', 26000, 'Doble carne 100 % de res, doble queso, doble tocineta, huevo frito, chorizo, vegetales'],
    ['Hamburguesa Chicken Asada', 17000, '100 % pechuga asada, chips de papa, jamón, queso, vegetales'],
    ['Hamburguesa Chicken Crispy', 19000, '100 % pechuga crispy, chips de papa, jamón, queso, vegetales'],
  ]],
  ['Perros', [
    ['Perro Clásico', 12000, 'Salchicha, queso, salsas, chips de papa'],
    ['Perro Tropical', 18000, 'Salchicha, chips de papa, jamón, piña melada, queso'],
    ['Perro De la Casa', 22000, 'Chorizo, queso, salsas, chips de papa, chicharrón, maduro, carne en trozos'],
    ['Perro Chori', 14000, 'Chorizo, chips de papa, queso'],
    ['Acompañante de papa francesa', 5000, 'Adición para hamburguesas y perros'],
  ]],
  ['Salchipapas', [
    ['Salchipapa Sencillo', 14000, 'Salchicha, papa francesa, huevo'],
    ['Salchipapa Ranchero', 20000, 'Salchicha, papa francesa, jamón, maíz, queso, huevo'],
    ['Salchipapa Paisa', 25000, 'Salchicha, queso, chorizo, maíz, carne en trozos, plátano, chicharrón'],
    ['Salchipapa Mega Bistro', 25000, 'Salchicha, chorizo, carnes en trozos, huevo, queso'],
    ['Salchipapa Super Full', 37000, '2 salchichas, 2 chorizos, queso, vegetales, plátano, carne en trozos, huevo'],
    ['Salchipapa Explosión', 52000, '3 salchichas, 3 chorizos, quesos, carne en trozos, huevo, vegetales, plátano, maíz'],
  ]],
  ['Parrilla', [
    ['Pechuga a la plancha', 30000, ''],
    ['Pechuga hawaiana', 33000, ''],
    ['Mojarra frita', 30000, ''],
    ['Trucha', 33000, ''],
    ['Churrasco', 30000, ''],
    ['Punta de anca', 30000, ''],
    ['Costillas a la BBQ', 30000, ''],
    ['Parrillada', 40000, 'Res, cerdo, chorizo, plátano y papa francesa'],
  ]],
  ['Bocados', [
    ['Patacones x3', 28000, 'Trozos de carne, maíz, queso, tocineta, francesa'],
    ['Maicitos', 25000, 'Trozos de carne, maíz, queso, tocineta, francesa'],
    ['Nuggets de pollo', 20000, ''],
  ]],
  ['Alas', [
    ['Alas x8 + francesa', 25000, '8 piezas con papa francesa'],
    ['Alas x12 + francesa', 31000, '12 piezas con papa francesa'],
  ]],
  ['Entrantes', [
    ['Huevos de codorniz x6', 5000, '6 unidades'],
    ['Porción de papas', 6000, ''],
    ['Tazón de papas a la francesa', 11000, ''],
  ]],
  ['Bebidas', [
    ['Coca-Cola', 5000, ''],
    ['Soda', 5000, ''],
    ['Agua', 4500, ''],
    ['Vaso con limón', 2000, ''],
    ['Cerveza', 5000, ''],
    ['Limonada', 7000, ''],
    ['Limonada especial', 12000, ''],
  ]],
  ['Postres', [
    ['Postre Bistro', 12000, 'Piña caramelizada con helado'],
    ['Brownie', 12000, 'Brownie caliente con helado'],
  ]],
  ['Promociones', [
    ['Promo 2 hamburguesas de la casa', 22000, ''],
    ['Promo 2 perros de la casa', 21000, ''],
    ['Promo 2 hamburguesas especiales', 29000, ''],
    ['Promo 2 hamburguesas de la casa + cervezas', 30000, ''],
    ['Promo 8 alas + 2 cervezas + papa francesa', 32000, ''],
  ]],
];

// Mesas del local: 9 en el interior y 5 en el exterior. [nombre, puestos]
// Los puestos son un valor inicial; se ajustan en Ajustes > Zonas y mesas.
const ZONES = [
  ['Interior', [['1', 4], ['2', 4], ['3', 4], ['4', 4], ['5', 4], ['6', 4], ['7', 4], ['8', 4], ['9', 4]]],
  ['Exterior', [['E1', 4], ['E2', 4], ['E3', 4], ['E4', 4], ['E5', 4]]],
];

module.exports = { MENU, ZONES };
