'use strict';

// 1-9: круглые столы на 4, 10: большой на 6, 11-16: диваны на 4, 17: длинный стол на 6.
const seats = (id) => (id === 10 || id === 17 ? 6 : 4);
module.exports = Array.from({ length: 17 }, (_, i) => ({ id: i + 1, seats: seats(i + 1) }));
