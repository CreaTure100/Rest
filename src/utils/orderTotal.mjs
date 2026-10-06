/**
 * Сумма заказа. quantities: { [id блюда]: количество }.
 * Блюдо, которого нет в меню, пропускается и НЕ обнуляет остальную сумму
 * (раньше из-за приоритета операторов `a + b * c || 0` сумма сбрасывалась в 0).
 * Считаем в копейках, чтобы не копить ошибку float.
 */
export function calculateTotal(quantities, menuItems) {
  let cents = 0
  for (const [id, qty] of Object.entries(quantities)) {
    const item = menuItems.find((m) => m.id === Number(id))
    if (item) cents += Math.round(Number(item.price) * 100) * Number(qty)
  }
  return cents / 100
}
