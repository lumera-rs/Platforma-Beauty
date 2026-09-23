# Neon branch identity verification

Date: 2026-09-23. Branch: phase7/target-identity-neon-branch, based on current main f6e113e5.

External connections were limited to the two owner-authorized test branches, inside read-only transactions. No development or production database was accessed, and no writes or migrations were run against either external branch. Regression tests created and migrated only runner-owned local disposable PostgreSQL fixtures. No deployment or publication was performed. Credential URLs are intentionally absent.

## Observed collision

| Signal | First branch | Second branch |
|---|---|---|
| database_name | neondb | neondb |
| system_identifier | 7688718332222926027 | 7688718332222926027 |
| encrypted | false | false |
| neon.project_id | patient-band-58516090 | patient-band-58516090 |
| neon.branch_id | br-falling-surf-b1mlfio0 | br-odd-sound-b1os4cyc |
| neon.tenant_id | 7fa011735a19e14b92eafa55755fc486 | 7fa011735a19e14b92eafa55755fc486 |
| neon.timeline_id | 6f9378ad07eca588dbf37ea50ccf4eb9 | 358c16d2ef318fdff776713a89f3e3f9 |

The original database/system/transport tuple collides. The tenant is also shared; the timeline differs. The provider exposes a distinct console branch_id: do not confuse it with timeline_id. The additive discriminator uses both tenant_id and timeline_id and deliberately does not pin ephemeral compute/endpoint identities.

## Complete first-branch neon.* settings

Query: `SELECT name, setting FROM pg_settings WHERE name LIKE 'neon.%' ORDER BY name`. All 121 returned rows follow, without omission. These are database settings, not secret connection strings. Empty settings are shown as `(empty)`.

| Name | Setting |
|---|---|
| neon.allow_replica_misconfig | on |
| neon.allow_unstable_extensions | off |
| neon.allowed_extensions | address_standardizer,address_standardizer_data_us,amcheck,anon,age,auth_delay,autoinc,bloom,btree_gin,btree_gist,citext,cube,databricks_auth,dblink,dbrx,dict_int,dict_xsyn,earthdistance,fuzzystrmatch,h3,h3_postgis,hll,hstore,hypopg,insert_username,intagg,intarray,ip4r,isn,lo,ltree,moddatetime,neon,neon_rmgr,neon_utils,old_snapshot,online_advisor,pageinspect,passwordcheck,pg_buffercache,pg_cron,pg_duckdb,pg_freespacemap,pg_graphql,pg_hashids,pg_hint_plan,pg_jsonschema,pg_logicalinspect,pg_mooncake,pg_partman,pg_prewarm,pg_repack,pg_search,pg_session_jwt,pg_stash_advice,pg_stat_statements,pg_surgery,pg_tiktoken,pg_tracing,pg_trgm,pg_uuidv7,pg_visibility,pg_walinspect,pgaudit,pgauditlogtofile,pgcrypto,pgjwt,pgrouting,pgrowlocks,pgstattuple,pgtap,pgx_ulid,plcoffee,plls,plpgsql,plpgsql_check,plv8,postgis,postgis_raster,postgis_sfcgal,postgis_tiger_geocoder,postgis_topology,postgres_fdw,prefix,rag,rag_bge_small_en_v15,rag_jina_reranker_v1_tiny_en,rdkit,refint,roaringbitmap,rum,seg,semver,sslinfo,tablefunc,tcn,timescaledb,tsm_system_rows,tsm_system_time,ulid,unaccent,unit,uuid-ossp,vector,wal2delta,wal2json,xml2,lakebase_vector,lakebase_text,lakebase_tokenizer |
| neon.autoscaling_state_transfer_enabled | off |
| neon.branch_id | br-falling-surf-b1mlfio0 |
| neon.buffer_cache_prewarm_limit | 2147483647 |
| neon.buffer_cache_prewarm_mb_per_second | -1 |
| neon.checkpoint_fpi_percentage | 100 |
| neon.communicator_error_on_beyond_eof | on |
| neon.communicator_max_prefetch_ring_size | 13926 |
| neon.communicator_min_prefetch_ring_size | 1024 |
| neon.communicator_mode | multiplexer |
| neon.communicator_notify_pipe_size | 153 |
| neon.communicator_prefetch_batching_enabled | on |
| neon.communicator_prefetch_buffers_per_backend | 1024 |
| neon.communicator_prefetch_ring_extension_threshold | 10 |
| neon.communicator_prefetch_ring_shrink_observation_ms | 300000 |
| neon.communicator_prefetch_ring_shrink_step | 0 |
| neon.communicator_prefetch_rpcs_per_backend | 4 |
| neon.compute_id | compute-dry-art-b1h7v8sz |
| neon.compute_mode | primary |
| neon.console_url | http://neon-control-plane-api.neon-control-plane.svc.cluster.local:9096/compute/api/v2/endpoints/ep-broad-shape-b1uly888/dbs_and_roles |
| neon.crc_cache_size | 0 |
| neon.debug_compare_local | none |
| neon.deprecated_extensions | pg_search,plv8 |
| neon.disable_checkpoint_flush_buffers | off |
| neon.disable_data_checksums | off |
| neon.disable_logical_replication_subscribers | off |
| neon.disable_wal_prevlink_checks | off |
| neon.enable_logical_replication_promote | on |
| neon.enable_prewarm_getpage_tagging | off |
| neon.enable_replica_lag_optimization | on |
| neon.enable_tiered_cache | off |
| neon.endpoint_id | ep-broad-shape-b1uly888 |
| neon.event_triggers | on |
| neon.extension_server_connect_timeout | 60 |
| neon.extension_server_port | 3081 |
| neon.extension_server_request_timeout | 60 |
| neon.file_cache_chunk_size | 16 |
| neon.file_cache_path | /neonvm/cache/pg_cache |
| neon.file_cache_prewarm_batch | 128 |
| neon.file_cache_prewarm_limit | 2147483647 |
| neon.file_cache_prewarm_mb_per_second | -1 |
| neon.file_cache_size_limit | 819MB |
| neon.flush_output_after | 8 |
| neon.forward_ddl | on |
| neon.keep_ls_slot | wal2delta_main_slot_ |
| neon.lag_mb_to_evict_lfc | -1 |
| neon.lakebase_mode | off |
| neon.last_written_lsn_cache_parts | 1 |
| neon.last_written_lsn_cache_size | 131072 |
| neon.lfc_assert_clean_buffers_on_shutdown | off |
| neon.lfc_check_page_fingerprint | on |
| neon.lfc_check_page_verification | on |
| neon.lfc_check_zero_page_bitmap | on |
| neon.lfc_fsync_threshold | -1 |
| neon.lfc_metadata_save | off |
| neon.lfc_metadata_save_writeback_masked_pages | on |
| neon.lfc_partitions | 1 |
| neon.logical_replication_max_logicalsnapdir_size | 8000 |
| neon.logical_replication_max_snap_files | 10000 |
| neon.lwlsn_assert_pd_lsn | off |
| neon.lwlsn_metadata_save | off |
| neon.max_cluster_size | 512 |
| neon.max_file_cache_size | 6553 |
| neon.max_reconnect_attempts | 60 |
| neon.membership_roles_filter | databricks_superuser,neon_superuser,pg_read_all_data,pg_write_all_data,pg_monitor,pg_signal_backend,pg_create_subscription,pg_maintain,pg_checkpoint |
| neon.monitor_query_exec_time | off |
| neon.optimize_writes_for_streaming | off |
| neon.pageserver_attachment_connect_backoff_initial_available | 1000 |
| neon.pageserver_attachment_connect_backoff_initial_unavailable | 50 |
| neon.pageserver_attachment_connect_backoff_jitter_pct | 100 |
| neon.pageserver_attachment_connect_backoff_max_available | 30000 |
| neon.pageserver_attachment_connect_backoff_max_unavailable | 1000 |
| neon.pageserver_attachment_connect_backoff_multiplier_pct | 200 |
| neon.pageserver_attachment_updates_enabled | on |
| neon.pageserver_connection_info | {"shard_count":0,"prefer_protocols":["grpc","libpq"],"prefer_protocol":"grpc","shards":{"0000":{"pageservers":[{"id":6,"urls":["postgresql://pageserver-2.cell-5.eu-central-1.aws.neon.tech:6400","grpc://pageserver-2.cell-5.eu-central-1.aws.neon.tech:5100"],"libpq_url":"postgresql://pageserver-2.cell-5.eu-central-1.aws.neon.tech:6400","grpc_url":"grpc://pageserver-2.cell-5.eu-central-1.aws.neon.tech:5100"},{"id":3,"urls":["postgresql://pageserver-3.cell-5.eu-central-1.aws.neon.tech:6400","grpc://pageserver-3.cell-5.eu-central-1.aws.neon.tech:5100"],"libpq_url":"postgresql://pageserver-3.cell-5.eu-central-1.aws.neon.tech:6400","grpc_url":"grpc://pageserver-3.cell-5.eu-central-1.aws.neon.tech:5100"}]}}} |
| neon.pageserver_connstring | host=pageserver-2.cell-5.eu-central-1.aws.neon.tech port=6400 |
| neon.pageserver_grpc_connect_timeout | 5000 |
| neon.pageserver_grpc_keepalive_interval | 10000 |
| neon.pageserver_grpc_keepalive_timeout | 5000 |
| neon.pageserver_grpc_prefetch_timeout_total | 20000 |
| neon.pageserver_grpc_reap_idle_threshold | 600000 |
| neon.pageserver_grpc_request_backoff_base | 5 |
| neon.pageserver_grpc_request_backoff_max | 5000 |
| neon.pageserver_grpc_request_timeout_attempt | 60000 |
| neon.pageserver_grpc_request_timeout_total | 0 |
| neon.pageserver_response_disconnect_timeout | 150000 |
| neon.pageserver_response_log_timeout | 10000 |
| neon.persist_replica_logical_slots | off |
| neon.pgstat_file_size_limit | 16384 |
| neon.prewarm_max_prefetch_requests | 4 |
| neon.prewarm_update_ws_estimation | on |
| neon.privileged_role_name | neon_superuser |
| neon.project_id | patient-band-58516090 |
| neon.protocol_version | 3 |
| neon.readahead_buffer_size | 128 |
| neon.readahead_getpage_pull_timeout | 50 |
| neon.regress_test_mode | off |
| neon.relperst_hash_size | 16384 |
| neon.relsize_cache_prime_from_basebackup | on |
| neon.relsize_hash_size | 65536 |
| neon.replica_lag_mb_for_lock_priority | 100 |
| neon.running_xacts_overflow_policy | ignore |
| neon.safekeeper_connect_timeout | 10000 |
| neon.safekeeper_conninfo_options | (empty) |
| neon.safekeeper_proto_version | 4 |
| neon.safekeeper_reconnect_timeout | 1000 |
| neon.safekeepers | g#1:safekeeper-5.cell-5.eu-central-1.aws.neon.tech:6401,safekeeper-4.cell-5.eu-central-1.aws.neon.tech:6401,safekeeper-3.cell-5.eu-central-1.aws.neon.tech:6401 |
| neon.shared_buffers_wss_estimation | off |
| neon.startup_process_lock_priority | off |
| neon.store_prefetch_result_in_lfc | off |
| neon.stripe_size | 2048 |
| neon.temp_file_limit_global_mb | -1 |
| neon.tenant_id | 7fa011735a19e14b92eafa55755fc486 |
| neon.tiered_cache_max_pending_lfc_writes | 5 |
| neon.timeline_id | 6f9378ad07eca588dbf37ea50ccf4eb9 |
| neon.track_quorum_commit_latency | on |
| neon.track_wait_events | on |
| neon.unstable_extensions | rag,rag_bge_small_en_v15,rag_jina_reranker_v1_tiny_en,pg_mooncake,anon |
| neon.wal_proposer_id | a87692fe-a4c1-4f83-8140-1bfe51d1bd08 |

## Live check after the fix

The expected first-branch identity was declared from its own observed database name, system identifier, backend transport, tenant and timeline. The first connection remained open in a READ ONLY transaction throughout these checks.

| Expected discriminator on the first connection | Result | Identity queries |
|---|---|---|
| Its own tenant/timeline | PASS | 1 |
| Second branch tenant/timeline | REFUSED: `Target identity mismatch: neon.timelineId` | 1 |
| No discriminator | REFUSED: `Target identity mismatch: neon.tenantId expected value is required` | 1 |

No migration runner mutation was invoked in either live proof. Both transactions were rolled back and connections closed.

## Regression verification

The following database-free checks completed successfully:

| Normal repository command/check | Result |
|---|---|
| `test:migrations` with `LUMERA_PHASE4_UNIT_ONLY=1` | 27 passed, 0 failed, 0 skipped |
| `test:migrations:phase5:unit` | 87 passed, 0 failed, 1 deliberate integration-only characterization skip |
| Final focused `target-identity.test.ts` after CLI refusal hardening | 10 passed, 0 failed, 0 skipped |
| `test:reconstruction:docs` | 13 Node tests passed; 114 diagnostic negative cases and 65 execution negative fixtures passed |
| `git diff --check` | Passed |

The ten target identity unit test results:

| Test | Result |
|---|---|
| All real deployment marker forms block each development runtime gate | PASS |
| Development schema entrypoint rejects every marker before configured database import | PASS |
| Identity is explicitly validated, never inferred from a URL or environment | PASS |
| Neon CLI identity flags are paired, validated, and reject duplicates | PASS |
| Identity evidence fails closed on every mismatch and unavailable backend evidence | PASS |
| Neon identity requires and matches the canonical tenant and timeline pair | PASS |
| Incomplete, malformed, or absent Neon backend evidence is field-specifically indeterminate | PASS |
| Identity verification performs exactly one read-only SELECT | PASS |
| Apply and adoption identity refusal happens before any lock or bookkeeping | PASS |
| Narrowed and empty manifests always verify identity before branching or bookkeeping | PASS |

These cases include non-Neon/no discriminator success, Neon/correct pair success,
Neon/no pair refusal, both directions of one-field-only matching refusal,
non-Neon/supplied pair refusal, partial/malformed expected and actual evidence,
duplicate or bare CLI flags, and refusing Neon flags on read-only `status` rather
than silently ignoring a declaration it cannot verify.

### Disposable PostgreSQL integration results

The full normal `test:migrations:phase5:integration` runner also completed:
**101 tests passed across all 11 selected suites (12 test files), zero failed or
skipped.** This includes the phase 4 integration suite. The runner used an owned
PostgreSQL 16 cluster on loopback at a non-default port and reported
`ownedClusterRemoved: true`, `status: passed`, and `cleanupErrors: []`.

| Disposable suite/file | Passed |
|---|---:|
| Phase 4 migrations (including nested ledger cases) | 37 |
| Equivalence characterization | 4 |
| Target identity | 6 |
| Supported state | 15 |
| Supported convergence | 4 |
| Adoption boundary | 1 |
| Namespace boundary | 1 |
| Actual entrypoint boot | 5 |
| Legacy boot refusal | 1 |
| Historical startup-data regressions | 13 |
| Historical subscription reconciliation | 13 |
| Interrupted recovery | 1 |

The characterization intentionally skipped in the database-free unit command
therefore ran and passed here. Existing non-Neon disposable identity paths
required no discriminator and remained passing; no identity or safety guard
was bypassed for testing.

### Protected manifest verification

The complete direct census covered all 73 diagnostic `currentInputs` and all 85
execution `files`. Only the three branch-changed protected source paths required
amendments in each current tier: `PHASE-5B-RUNBOOK.md`, `cli.ts`, and
`migrations.test.ts`. The seventh amendment is the nested diagnostic-manifest hash
in the execution manifest. Every old/new hash and the completed cascade is
recorded in [execution provenance](../production-evidence-execution-plan/provenance.md).
Final current-tier drift: zero.

Both historical blocks remain raw-byte-identical to `origin/main`:

| Historical block | Bytes | SHA-256 |
|---|---:|---|
| Diagnostic `inputs` | 8954 | `f189dd413b3b6564faf10bd5c53d294483e6e05a4f21af5cbd72535bfe967a29` |
| Execution `originalProtectedFiles` | 8968 | `1161b1c0cb6b8e2520e7993f88634e66c039b2d4babad8783ec399361c43ae17` |

## Scope

No schema/application migration, booking, authentication or authorization changes. This work does not authorize Neon production use. Ordinary non-Neon targets return NULL for both missing-ok settings and retain the existing identity requirements; supplying a Neon discriminator to such a target fails closed.
