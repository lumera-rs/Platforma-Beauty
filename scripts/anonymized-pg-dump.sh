#!/usr/bin/env bash
set -Eeuo pipefail

# Create a restore-ready, anonymized PostgreSQL custom-format dump.  The source
# is only ever opened by pg_dump or a read-only psql session; all UPDATEs run in
# a newly-created disposable database.

usage() {
  cat <<'EOF'
Usage: scripts/anonymized-pg-dump.sh OUTPUT.dump

Required environment:
  SOURCE_DATABASE_URL   Database to copy (never mutated)
  TARGET_ADMIN_URL      Connection to a maintenance DB on the disposable server
  TARGET_DATABASE_URL  Connection URL whose database is TARGET_DB_NAME
  TARGET_DB_NAME        New database name; must begin with "anon_"
  ANONYMIZATION_SALT    Stable secret (at least 16 characters)
  ALLOW_ANONYMIZED_COPY=yes

Optional:
  KEEP_TARGET_DB=1      Keep the disposable database after success (default drops it)

The target DB must not already exist. The script dumps/restores the complete
schema and data, discovers sensitive columns from PostgreSQL's catalogs, masks
the copy deterministically, verifies row counts, schema, constraints and mask
formats, and finally emits a pg_dump custom archive suitable for pg_restore.

Example:
  ALLOW_ANONYMIZED_COPY=yes TARGET_DB_NAME=anon_qa_20250101 \
  SOURCE_DATABASE_URL=... TARGET_ADMIN_URL=... TARGET_DATABASE_URL=... \
  ANONYMIZATION_SALT='team-secret-at-least-16-chars' \
  scripts/anonymized-pg-dump.sh ./tmp/qa-anonymized.dump
EOF
}

die() { printf 'anonymized-pg-dump: %s\n' "$*" >&2; exit 1; }
[[ ${1:-} != "--help" && ${1:-} != "-h" ]] || { usage; exit 0; }
[[ $# -eq 1 ]] || { usage >&2; exit 2; }

output=$1
: "${SOURCE_DATABASE_URL:?SOURCE_DATABASE_URL is required}"
: "${TARGET_ADMIN_URL:?TARGET_ADMIN_URL is required}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
: "${TARGET_DB_NAME:?TARGET_DB_NAME is required}"
: "${ANONYMIZATION_SALT:?ANONYMIZATION_SALT is required}"
[[ ${ALLOW_ANONYMIZED_COPY:-} == yes ]] ||
  die "refusing to run without ALLOW_ANONYMIZED_COPY=yes"
[[ $TARGET_DB_NAME =~ ^anon_[a-zA-Z0-9_]+$ ]] ||
  die "TARGET_DB_NAME must match ^anon_[a-zA-Z0-9_]+$"
[[ ${#ANONYMIZATION_SALT} -ge 16 ]] ||
  die "ANONYMIZATION_SALT must contain at least 16 characters"
[[ $SOURCE_DATABASE_URL != "$TARGET_DATABASE_URL" ]] ||
  die "source and target URLs must differ"
[[ $output == *.dump ]] || die "output filename must end in .dump"
[[ ! -e $output ]] || die "refusing to overwrite existing output: $output"

for command in pg_dump pg_restore psql createdb dropdb cmp mktemp; do
  command -v "$command" >/dev/null || die "required command not found: $command"
done

workdir=$(mktemp -d "${TMPDIR:-/tmp}/anonymized-pg-dump.XXXXXX")
created=0
cleanup() {
  local status=$?
  rm -rf "$workdir"
  if [[ $created == 1 && ${KEEP_TARGET_DB:-0} != 1 ]]; then
    dropdb --if-exists --force --maintenance-db="$TARGET_ADMIN_URL" "$TARGET_DB_NAME" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

# These are the only source psql statements. PGOPTIONS makes accidental writes
# impossible even if a future edit changes either query.
source_identity=$(PGOPTIONS='-c default_transaction_read_only=on' \
  psql "$SOURCE_DATABASE_URL" -XAtqc \
  "select current_setting('server_version_num') || '|' || current_database() || '|' || inet_server_addr()::text || '|' || inet_server_port()")
admin_identity=$(psql "$TARGET_ADMIN_URL" -XAtqc \
  "select current_database() || '|' || inet_server_addr()::text || '|' || inet_server_port()")
source_db=${source_identity#*|}; source_db=${source_db%%|*}
source_endpoint=${source_identity#*|}; source_endpoint=${source_endpoint#*|}
admin_endpoint=${admin_identity#*|}
[[ $source_db != "$TARGET_DB_NAME" ]] || die "target database name equals source database"
[[ $source_endpoint != "$admin_endpoint" || $source_db != "$TARGET_DB_NAME" ]] ||
  die "target resolves to the source database"

# pg_dump uses a repeatable, read-only snapshot. No SQL that can mutate the
# source is issued anywhere in this script.
PGOPTIONS='-c default_transaction_read_only=on' \
  pg_dump "$SOURCE_DATABASE_URL" --format=custom --no-owner --no-privileges \
  --file="$workdir/source.dump"
PGOPTIONS='-c default_transaction_read_only=on' \
  pg_dump "$SOURCE_DATABASE_URL" --schema-only --no-owner --no-privileges \
  --file="$workdir/source-schema.sql"

createdb --maintenance-db="$TARGET_ADMIN_URL" "$TARGET_DB_NAME"
created=1
target_db=$(psql "$TARGET_DATABASE_URL" -XAtqc "select current_database()")
[[ $target_db == "$TARGET_DB_NAME" ]] ||
  die "TARGET_DATABASE_URL does not select TARGET_DB_NAME"
pg_restore --exit-on-error --no-owner --no-privileges \
  --dbname="$TARGET_DATABASE_URL" "$workdir/source.dump"

# Exact per-table counts before masking. COPY/restore has already established
# the source row cardinality, so verification never needs a writable source
# connection.
psql "$TARGET_DATABASE_URL" -XAtq -F '|' >"$workdir/counts-before" <<'SQL'
select n.nspname, c.relname, c.reltuples::bigint
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema')
order by 1,2;
SQL

psql "$TARGET_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v mask_salt="$ANONYMIZATION_SALT" <<'SQL'
set app.anonymization_salt to :'mask_salt';

create or replace function pg_temp.mask_json(value jsonb, path text default '')
returns jsonb language plpgsql immutable as $$
declare k text; v jsonb; result jsonb;
begin
  if jsonb_typeof(value) = 'object' then
    result := '{}'::jsonb;
    for k,v in select * from jsonb_each(value) loop
      if k ~* '(email|phone|mobile|fax|name|address|pib|tax|company.?id|bank|account|iban|card|password|secret|token|message|note|comment|amount|price|payment|invoice|recipient)' then
        result := result || jsonb_build_object(k,
          case when jsonb_typeof(v)='number' then '0'::jsonb
               else to_jsonb('redacted_' || substr(md5(v::text || current_setting('app.anonymization_salt')),1,16)) end);
      else
        result := result || jsonb_build_object(k, pg_temp.mask_json(v, path || '.' || k));
      end if;
    end loop;
    return result;
  elsif jsonb_typeof(value) = 'array' then
    select coalesce(jsonb_agg(pg_temp.mask_json(x, path)), '[]'::jsonb) into result
    from jsonb_array_elements(value) x;
    return result;
  end if;
  return value;
end $$;

create temp table mask_plan as
select n.nspname schema_name, c.relname table_name, a.attname column_name,
       t.typname type_name, a.atttypmod,
       case
         when a.attname ~* '(password|passwd).*hash|password|passwd' then 'password'
         when a.attname ~* 'email' then 'email'
         when a.attname ~* '(phone|mobile|fax)' then 'phone'
         when a.attname ~* '(^|_)(pib|tax_id|vat_number|maticni_broj|registration_number|company_(id|number))($|_)' then 'company_id'
         when a.attname ~* '(iban|bank_account|account_number|card_number|swift|bic)' then 'bank'
         when a.attname ~* '(first_name|last_name|full_name|display_name|contact_name|recipient_name|owner_name|legal_name|company_name|^name$)' then 'name'
         when a.attname ~* '(message|note|description|comment|body|subject|reason|address|street|city|postal)' then 'free_text'
         when a.attname ~* '(secret|token|api_key|credential|ip_address|user_agent|payment_reference|invoice_number|transaction_id)' then 'secret'
         when t.typname in ('json','jsonb') and a.attname ~* '(contact|customer|recipient|billing|shipping|payment|financial|metadata|snapshot|payload|details)' then 'json'
       end category
from pg_attribute a
join pg_class c on c.oid=a.attrelid
join pg_namespace n on n.oid=c.relnamespace
join pg_type t on t.oid=a.atttypid
where c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped
  and a.attgenerated=''
  and n.nspname not in ('pg_catalog','information_schema')
  and t.typname in ('text','varchar','bpchar','citext','json','jsonb');

delete from mask_plan where category is null;

do $$
declare r record; fk_count integer; expression text; max_len integer;
begin
  select count(*) into fk_count
  from mask_plan m join pg_constraint con
    on con.conrelid=format('%I.%I',m.schema_name,m.table_name)::regclass
   and con.contype in ('p','f') and
      (select attnum from pg_attribute where attrelid=con.conrelid and attname=m.column_name)=any(con.conkey);
  if fk_count > 0 then
    raise exception 'Refusing partial anonymization: % sensitive PK/FK column(s) require an explicit referential mapping', fk_count;
  end if;

  for r in select * from mask_plan order by schema_name,table_name,column_name loop
    max_len := case when r.atttypmod > 4 then r.atttypmod-4 else 1000000 end;
    expression := case r.category
      when 'password' then quote_literal('$2b$12$C6UzMDM.H6dfI/f/IKcEe.2bAfnj4g9kPZ9Q1LQhP4KxK4mY3zK2a')
      when 'email' then format('left(%L || substr(md5(coalesce(%I::text,%L)||current_setting(%L)),1,16) || %L,%s)',
                               'anon_',r.column_name,'','app.anonymization_salt','@example.invalid',max_len)
      when 'phone' then format('left(%L || translate(md5(coalesce(%I::text,%L)||current_setting(%L)),%L,%L),%s)',
                               '3816',r.column_name,'','app.anonymization_salt','abcdef','123456',max_len)
      when 'company_id' then format('left(translate(md5(coalesce(%I::text,%L)||current_setting(%L)),%L,%L),least(9,%s))',
                                    r.column_name,'','app.anonymization_salt','abcdef','123456',max_len)
      when 'bank' then format('left(translate(md5(coalesce(%I::text,%L)||current_setting(%L)),%L,%L),least(18,%s))',
                              r.column_name,'','app.anonymization_salt','abcdef','123456',max_len)
      when 'name' then format('left(%L || substr(md5(coalesce(%I::text,%L)||current_setting(%L)),1,16),%s)',
                              'anon_',r.column_name,'','app.anonymization_salt',max_len)
      when 'free_text' then format('left(%L || substr(md5(coalesce(%I::text,%L)||current_setting(%L)),1,16),%s)',
                                   'redacted_',r.column_name,'','app.anonymization_salt',max_len)
      when 'json' then format('pg_temp.mask_json(%I::jsonb)::%s',r.column_name,r.type_name)
      else format('left(%L || substr(md5(coalesce(%I::text,%L)||current_setting(%L)),1,24),%s)',
                  'anon_',r.column_name,'','app.anonymization_salt',max_len)
    end;
    execute format('update %I.%I set %I=%s where %I is not null',
                   r.schema_name,r.table_name,r.column_name,expression,r.column_name);
  end loop;
  raise notice 'Masked % catalog-discovered sensitive columns', (select count(*) from mask_plan);
end $$;

-- Format checks make accidental no-op/incorrect masks fail closed.
do $$
declare r record; bad bigint; predicate text;
begin
  for r in select * from mask_plan where category <> 'json' loop
    predicate := case r.category
      when 'password' then format('%I <> %L',r.column_name,'$2b$12$C6UzMDM.H6dfI/f/IKcEe.2bAfnj4g9kPZ9Q1LQhP4KxK4mY3zK2a')
      when 'email' then format('%I !~ %L',r.column_name,'^anon_[0-9a-f]+@example\.invalid$')
      when 'phone' then format('%I !~ %L',r.column_name,'^[0-9]+$')
      when 'company_id' then format('%I !~ %L',r.column_name,'^[0-9]+$')
      when 'bank' then format('%I !~ %L',r.column_name,'^[0-9]+$')
      when 'free_text' then format('%I !~ %L',r.column_name,'^redacted_[0-9a-f]+$')
      else format('%I !~ %L',r.column_name,'^anon_[0-9a-f]+$')
    end;
    execute format('select count(*) from %I.%I where %I is not null and (%s)',
                   r.schema_name,r.table_name,r.column_name,predicate) into bad;
    if bad > 0 then raise exception 'Mask verification failed for %.%.% (% rows)',r.schema_name,r.table_name,r.column_name,bad; end if;
  end loop;
end $$;
SQL

psql "$TARGET_DATABASE_URL" -XAtq -F '|' >"$workdir/counts-after" <<'SQL'
select n.nspname, c.relname, c.reltuples::bigint
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema')
order by 1,2;
SQL
cmp -s "$workdir/counts-before" "$workdir/counts-after" ||
  die "row-count verification failed"

invalid_constraints=$(psql "$TARGET_DATABASE_URL" -XAtqc \
  "select count(*) from pg_constraint where not convalidated")
[[ $invalid_constraints == 0 ]] || die "$invalid_constraints constraints are not validated"

pg_dump "$TARGET_DATABASE_URL" --schema-only --no-owner --no-privileges \
  --file="$workdir/target-schema.sql"
cmp -s "$workdir/source-schema.sql" "$workdir/target-schema.sql" ||
  die "schema verification failed: source and anonymized schemas differ"

mkdir -p "$(dirname "$output")"
pg_dump "$TARGET_DATABASE_URL" --format=custom --no-owner --no-privileges \
  --file="$workdir/final.dump"
mv "$workdir/final.dump" "$output"
printf 'Created verified anonymized dump: %s\n' "$output"