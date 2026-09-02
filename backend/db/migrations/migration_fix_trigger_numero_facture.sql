-- =============================================================================
-- FIX TRIGGER generer_numero_facture
-- 7venHotel Cloud PMS
--
-- BUG : COUNT(*)::TEXT + 1 → opérateur n'existe pas (text + integer)
-- FIX : (COUNT(*) + 1)::TEXT — addition entière PUIS cast text
-- =============================================================================

CREATE OR REPLACE FUNCTION generer_numero_facture()
RETURNS TRIGGER AS $$
DECLARE
  annee TEXT := TO_CHAR(NOW(), 'YYYY');
  seq TEXT;
BEGIN
  SELECT LPAD((COUNT(*) + 1)::TEXT, 4, '0')
  INTO seq
  FROM factures
  WHERE hotel_id = NEW.hotel_id
    AND EXTRACT(YEAR FROM cree_le) = EXTRACT(YEAR FROM NOW());
  NEW.numero_facture := 'FAC-' || annee || '-' || seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
