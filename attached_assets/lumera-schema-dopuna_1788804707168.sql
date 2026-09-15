BEGIN;
DO $$ BEGIN CREATE TYPE appointment_deposit_status AS ENUM ('pending', 'paid', 'waived', 'refunded', 'forfeited'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE appointment_waitlist_status AS ENUM ('waiting', 'notified', 'converted', 'cancelled', 'expired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS appointment_add_ons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    add_on_id uuid,
    name text NOT NULL,
    duration_minutes integer NOT NULL,
    price integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS appointment_deposits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    salon_id uuid NOT NULL,
    amount integer NOT NULL,
    status appointment_deposit_status DEFAULT 'pending'::appointment_deposit_status NOT NULL,
    settled_at timestamp with time zone,
    settled_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appointment_deposits_amount_check CHECK ((amount >= 0))
);
CREATE TABLE IF NOT EXISTS appointment_employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    appointment_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE IF NOT EXISTS appointment_waitlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    salon_id uuid NOT NULL,
    service_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    employee_id uuid,
    desired_date date NOT NULL,
    earliest_time text DEFAULT '00:00'::text NOT NULL,
    latest_time text DEFAULT '23:59'::text NOT NULL,
    status appointment_waitlist_status DEFAULT 'waiting'::appointment_waitlist_status NOT NULL,
    notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT appointment_waitlist_window_check CHECK ((earliest_time < latest_time))
);
CREATE TABLE IF NOT EXISTS service_add_on_resource_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    add_on_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    CONSTRAINT service_add_on_resource_quantity_check CHECK ((quantity >= 1))
);
CREATE TABLE IF NOT EXISTS service_add_ons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_id uuid NOT NULL,
    name text NOT NULL,
    duration_minutes integer DEFAULT 0 NOT NULL,
    price integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_add_ons_duration_check CHECK ((duration_minutes >= 0)),
    CONSTRAINT service_add_ons_price_check CHECK ((price >= 0))
);
ALTER TABLE ONLY appointment_add_ons
    ADD CONSTRAINT appointment_add_ons_pkey PRIMARY KEY (id);
ALTER TABLE ONLY appointment_deposits
    ADD CONSTRAINT appointment_deposits_pkey PRIMARY KEY (id);
ALTER TABLE ONLY appointment_employees
    ADD CONSTRAINT appointment_employees_pkey PRIMARY KEY (id);
ALTER TABLE ONLY appointment_waitlist
    ADD CONSTRAINT appointment_waitlist_pkey PRIMARY KEY (id);
ALTER TABLE ONLY service_add_on_resource_requirements
    ADD CONSTRAINT service_add_on_resource_requirements_pkey PRIMARY KEY (id);
ALTER TABLE ONLY service_add_ons
    ADD CONSTRAINT service_add_ons_pkey PRIMARY KEY (id);
CREATE INDEX IF NOT EXISTS appointment_add_ons_add_on_idx ON appointment_add_ons USING btree (add_on_id);
CREATE UNIQUE INDEX IF NOT EXISTS appointment_add_ons_appointment_add_on_unique ON appointment_add_ons USING btree (appointment_id, add_on_id);
CREATE INDEX IF NOT EXISTS appointment_add_ons_appointment_idx ON appointment_add_ons USING btree (appointment_id);
CREATE UNIQUE INDEX IF NOT EXISTS appointment_deposits_appointment_unique ON appointment_deposits USING btree (appointment_id);
CREATE INDEX IF NOT EXISTS appointment_deposits_salon_status_idx ON appointment_deposits USING btree (salon_id, status);
CREATE INDEX IF NOT EXISTS appointment_deposits_settled_by_idx ON appointment_deposits USING btree (settled_by_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS appointment_employees_appointment_employee_unique ON appointment_employees USING btree (appointment_id, employee_id);
CREATE INDEX IF NOT EXISTS appointment_employees_appointment_idx ON appointment_employees USING btree (appointment_id);
CREATE INDEX IF NOT EXISTS appointment_employees_employee_idx ON appointment_employees USING btree (employee_id);
CREATE INDEX IF NOT EXISTS appointment_waitlist_customer_idx ON appointment_waitlist USING btree (customer_id);
CREATE INDEX IF NOT EXISTS appointment_waitlist_employee_idx ON appointment_waitlist USING btree (employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS appointment_waitlist_live_unique ON appointment_waitlist USING btree (salon_id, service_id, customer_id, desired_date) WHERE (status = ANY (ARRAY['waiting'::appointment_waitlist_status, 'notified'::appointment_waitlist_status]));
CREATE INDEX IF NOT EXISTS appointment_waitlist_salon_date_status_idx ON appointment_waitlist USING btree (salon_id, desired_date, status);
CREATE INDEX IF NOT EXISTS appointment_waitlist_service_idx ON appointment_waitlist USING btree (service_id);
CREATE INDEX IF NOT EXISTS service_add_on_resource_resource_idx ON service_add_on_resource_requirements USING btree (resource_id);
CREATE UNIQUE INDEX IF NOT EXISTS service_add_on_resource_unique ON service_add_on_resource_requirements USING btree (add_on_id, resource_id);
CREATE INDEX IF NOT EXISTS service_add_ons_service_active_idx ON service_add_ons USING btree (service_id, active);
CREATE UNIQUE INDEX IF NOT EXISTS service_add_ons_service_name_unique ON service_add_ons USING btree (service_id, name);
ALTER TABLE ONLY appointment_add_ons
    ADD CONSTRAINT appointment_add_ons_add_on_id_service_add_ons_id_fk FOREIGN KEY (add_on_id) REFERENCES service_add_ons(id) ON DELETE SET NULL;
ALTER TABLE ONLY appointment_add_ons
    ADD CONSTRAINT appointment_add_ons_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE;
ALTER TABLE ONLY appointment_deposits
    ADD CONSTRAINT appointment_deposits_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE;
ALTER TABLE ONLY appointment_deposits
    ADD CONSTRAINT appointment_deposits_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE;
ALTER TABLE ONLY appointment_deposits
    ADD CONSTRAINT appointment_deposits_settled_by_user_id_users_id_fk FOREIGN KEY (settled_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY appointment_employees
    ADD CONSTRAINT appointment_employees_appointment_id_appointments_id_fk FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE;
ALTER TABLE ONLY appointment_employees
    ADD CONSTRAINT appointment_employees_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE RESTRICT;
ALTER TABLE ONLY appointment_waitlist
    ADD CONSTRAINT appointment_waitlist_customer_id_users_id_fk FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY appointment_waitlist
    ADD CONSTRAINT appointment_waitlist_employee_id_employees_id_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
ALTER TABLE ONLY appointment_waitlist
    ADD CONSTRAINT appointment_waitlist_salon_id_salons_id_fk FOREIGN KEY (salon_id) REFERENCES salons(id) ON DELETE CASCADE;
ALTER TABLE ONLY appointment_waitlist
    ADD CONSTRAINT appointment_waitlist_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE ONLY service_add_on_resource_requirements
    ADD CONSTRAINT service_add_on_resource_requirements_add_on_id_service_add_ons_ FOREIGN KEY (add_on_id) REFERENCES service_add_ons(id) ON DELETE CASCADE;
ALTER TABLE ONLY service_add_on_resource_requirements
    ADD CONSTRAINT service_add_on_resource_requirements_resource_id_salon_resource FOREIGN KEY (resource_id) REFERENCES salon_resources(id) ON DELETE CASCADE;
ALTER TABLE ONLY service_add_ons
    ADD CONSTRAINT service_add_ons_service_id_services_id_fk FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;

ALTER TABLE appointment_series ADD COLUMN IF NOT EXISTS recurrence_frequency text;
ALTER TABLE appointment_series ADD COLUMN IF NOT EXISTS recurrence_interval integer;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS buffer_minutes integer DEFAULT 0 NOT NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS post_processing_minutes integer DEFAULT 0 NOT NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS pre_processing_minutes integer DEFAULT 0 NOT NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS processing_minutes integer DEFAULT 0 NOT NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS seat_count integer DEFAULT 1 NOT NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS buffer_minutes integer DEFAULT 0 NOT NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS deposit_amount integer;
ALTER TABLE services ADD COLUMN IF NOT EXISTS post_processing_minutes integer DEFAULT 0 NOT NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS pre_processing_minutes integer DEFAULT 0 NOT NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS processing_minutes integer DEFAULT 0 NOT NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS required_employee_count integer DEFAULT 1 NOT NULL;
ALTER TABLE services ADD COLUMN IF NOT EXISTS seat_capacity integer DEFAULT 1 NOT NULL;

DO $$ BEGIN ALTER TABLE appointments ADD CONSTRAINT appointments_segments_check CHECK (((pre_processing_minutes >= 0) AND (processing_minutes >= 0) AND (post_processing_minutes >= 0) AND (((pre_processing_minutes = 0) AND (processing_minutes = 0) AND (post_processing_minutes = 0)) OR (((pre_processing_minutes + processing_minutes) + post_processing_minutes) = duration_minutes)))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE appointments ADD CONSTRAINT appointments_seat_count_check CHECK ((seat_count >= 1)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE services ADD CONSTRAINT services_segments_check CHECK (((pre_processing_minutes >= 0) AND (processing_minutes >= 0) AND (post_processing_minutes >= 0) AND (((pre_processing_minutes = 0) AND (processing_minutes = 0) AND (post_processing_minutes = 0)) OR (((pre_processing_minutes + processing_minutes) + post_processing_minutes) = duration_minutes)))); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE services ADD CONSTRAINT services_seat_capacity_check CHECK ((seat_capacity >= 1)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE services ADD CONSTRAINT services_required_employee_count_check CHECK ((required_employee_count >= 1)); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMIT;
