# v826 shop order approval

Protected admin page: `admin_shop_orders.html`.

Default view shows orders that still need action: pending payment or paid but not yet released to Printify. The page shows order reference/ID, customer and delivery data, items, subtotal, shipping, total due, amount received, payment status, confirmation email state, Printify state, tracking, shipment email state, and errors.

Payment verification requires entering the amount actually received. The server refuses verification when the received amount is below the authoritative order total. `Send to Printify` remains a separate explicit action and the server checks the verified amount again before creating/releasing the Printify order.
