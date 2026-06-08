INSERT INTO system_settings (`key`, value, description)
VALUES ('installation_price_per_kw', '2000', 'Approximate installation price per kW added to the kit price to calculate approx total cost')
ON DUPLICATE KEY UPDATE description = VALUES(description);
