-- Recalcula el segmento (A-F) de un cliente automáticamente cuando se le
-- carga/edita/borra una factura, sin importar por dónde entre (Cargar
-- factura a mano, Importar ventas, o el script de línea de comandos) —
-- todas pasan por la tabla `facturas`, así que un trigger ahí cubre todos
-- los caminos sin duplicar la lógica en cada uno.
--
-- Criterio (meses desde la última factura hasta hoy):
--   A = 1 mes | B = 2 meses | C = 3-4 meses | D = 5-8 meses | E = 9+ meses
--   F = nunca compró (no tiene ninguna factura vinculada)
--
-- Nota: esto SOLO se dispara al tocar una factura — un cliente que no tuvo
-- movimientos no "envejece" de segmento solo por el paso del tiempo (para
-- eso haría falta un job recalculando todo periódicamente, que no se pidió).
-- Tampoco se corrió un recálculo masivo sobre los clientes existentes: los
-- segmentos ya cargados en el import histórico quedan como están hasta que
-- ese cliente tenga una factura nueva.

create or replace function public.recalcular_segmento_cliente(p_cliente_id bigint)
returns void as $$
declare
  v_ultima_compra date;
  v_meses integer;
  v_segmento text;
begin
  select max(fecha) into v_ultima_compra from public.facturas where cliente_id = p_cliente_id;

  if v_ultima_compra is null then
    v_segmento := 'F';
    v_meses := null;
  else
    v_meses := (extract(year from age(current_date, v_ultima_compra)) * 12
                + extract(month from age(current_date, v_ultima_compra)))::integer;
    v_segmento := case
      when v_meses <= 1 then 'A'
      when v_meses = 2 then 'B'
      when v_meses between 3 and 4 then 'C'
      when v_meses between 5 and 8 then 'D'
      else 'E'
    end;
  end if;

  update public.clientes
  set segmento = v_segmento, meses_sin_comprar = v_meses, ultima_compra = v_ultima_compra
  where id = p_cliente_id;
end;
$$ language plpgsql;

create or replace function public.trigger_recalcular_segmento()
returns trigger as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.cliente_id is not null then
      perform public.recalcular_segmento_cliente(OLD.cliente_id);
    end if;
    return OLD;
  end if;

  if NEW.cliente_id is not null then
    perform public.recalcular_segmento_cliente(NEW.cliente_id);
  end if;
  if TG_OP = 'UPDATE' and OLD.cliente_id is not null and OLD.cliente_id is distinct from NEW.cliente_id then
    perform public.recalcular_segmento_cliente(OLD.cliente_id);
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_facturas_recalcular_segmento on public.facturas;
create trigger trg_facturas_recalcular_segmento
  after insert or update of fecha, cliente_id or delete on public.facturas
  for each row execute function public.trigger_recalcular_segmento();
