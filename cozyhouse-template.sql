--
-- PostgreSQL database dump
--

\restrict 4YK4ERoDFIrQRNdEopPlIEllhBmXL0qDhgSsafVHjSlXLSO34Lhed285midOOBb

-- Dumped from database version 15.16
-- Dumped by pg_dump version 15.16

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: InvoiceStatus; Type: TYPE; Schema: public; Owner: admin
--

CREATE TYPE public."InvoiceStatus" AS ENUM (
    'DRAFT',
    'SENT',
    'PAID',
    'OVERDUE',
    'CANCELLED'
);


ALTER TYPE public."InvoiceStatus" OWNER TO admin;

--
-- Name: MaintenanceStatus; Type: TYPE; Schema: public; Owner: admin
--

CREATE TYPE public."MaintenanceStatus" AS ENUM (
    'PENDING',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED'
);


ALTER TYPE public."MaintenanceStatus" OWNER TO admin;

--
-- Name: MeterType; Type: TYPE; Schema: public; Owner: admin
--

CREATE TYPE public."MeterType" AS ENUM (
    'WATER',
    'ELECTRIC'
);


ALTER TYPE public."MeterType" OWNER TO admin;

--
-- Name: PaymentStatus; Type: TYPE; Schema: public; Owner: admin
--

CREATE TYPE public."PaymentStatus" AS ENUM (
    'PENDING',
    'VERIFIED',
    'REJECTED'
);


ALTER TYPE public."PaymentStatus" OWNER TO admin;

--
-- Name: Role; Type: TYPE; Schema: public; Owner: admin
--

CREATE TYPE public."Role" AS ENUM (
    'OWNER',
    'ADMIN',
    'STAFF',
    'USER'
);


ALTER TYPE public."Role" OWNER TO admin;

--
-- Name: RoomStatus; Type: TYPE; Schema: public; Owner: admin
--

CREATE TYPE public."RoomStatus" AS ENUM (
    'VACANT',
    'OCCUPIED',
    'MAINTENANCE',
    'OVERDUE'
);


ALTER TYPE public."RoomStatus" OWNER TO admin;

--
-- Name: TenantStatus; Type: TYPE; Schema: public; Owner: admin
--

CREATE TYPE public."TenantStatus" AS ENUM (
    'ACTIVE',
    'MOVED_OUT'
);


ALTER TYPE public."TenantStatus" OWNER TO admin;

--
-- Name: WaterFeeMethod; Type: TYPE; Schema: public; Owner: admin
--

CREATE TYPE public."WaterFeeMethod" AS ENUM (
    'METER_USAGE',
    'METER_USAGE_MIN_AMOUNT',
    'METER_USAGE_MIN_UNITS',
    'METER_USAGE_PLUS_BASE',
    'METER_USAGE_TIERED',
    'FLAT_MONTHLY',
    'FLAT_PER_PERSON'
);


ALTER TYPE public."WaterFeeMethod" OWNER TO admin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Asset; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."Asset" (
    id text NOT NULL,
    "roomId" text NOT NULL,
    name text NOT NULL,
    "serialNumber" text,
    status text DEFAULT 'GOOD'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Asset" OWNER TO admin;

--
-- Name: Building; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."Building" (
    id text NOT NULL,
    name text NOT NULL,
    code text,
    floors integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Building" OWNER TO admin;

--
-- Name: Contract; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."Contract" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "roomId" text NOT NULL,
    "startDate" timestamp(3) without time zone NOT NULL,
    "endDate" timestamp(3) without time zone,
    deposit numeric(10,2) NOT NULL,
    "currentRent" numeric(10,2) NOT NULL,
    "occupantCount" integer DEFAULT 1 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "contractImageUrl" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Contract" OWNER TO admin;

--
-- Name: DormConfig; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."DormConfig" (
    id text NOT NULL,
    "dormName" text,
    address text,
    phone text,
    "lineId" text,
    "waterUnitPrice" numeric(10,2) NOT NULL,
    "waterFeeMethod" public."WaterFeeMethod" DEFAULT 'METER_USAGE'::public."WaterFeeMethod" NOT NULL,
    "waterFlatMonthlyFee" numeric(10,2),
    "waterFlatPerPersonFee" numeric(10,2),
    "waterMinAmount" numeric(10,2),
    "waterMinUnits" numeric(10,2),
    "waterBaseFee" numeric(10,2),
    "waterTieredRates" jsonb,
    "electricUnitPrice" numeric(10,2) NOT NULL,
    "electricFeeMethod" public."WaterFeeMethod" DEFAULT 'METER_USAGE'::public."WaterFeeMethod" NOT NULL,
    "electricFlatMonthlyFee" numeric(10,2),
    "electricMinAmount" numeric(10,2),
    "electricMinUnits" numeric(10,2),
    "electricBaseFee" numeric(10,2),
    "electricTieredRates" jsonb,
    "commonFee" numeric(10,2) NOT NULL,
    "bankAccount" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."DormConfig" OWNER TO admin;

--
-- Name: Invoice; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."Invoice" (
    id text NOT NULL,
    "contractId" text NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    "rentAmount" numeric(10,2) NOT NULL,
    "waterAmount" numeric(10,2) NOT NULL,
    "electricAmount" numeric(10,2) NOT NULL,
    "otherFees" numeric(10,2) DEFAULT 0 NOT NULL,
    discount numeric(10,2) DEFAULT 0 NOT NULL,
    "totalAmount" numeric(10,2) NOT NULL,
    status public."InvoiceStatus" DEFAULT 'DRAFT'::public."InvoiceStatus" NOT NULL,
    "dueDate" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Invoice" OWNER TO admin;

--
-- Name: InvoiceItem; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."InvoiceItem" (
    id text NOT NULL,
    "invoiceId" text NOT NULL,
    description text NOT NULL,
    amount numeric(10,2) NOT NULL
);


ALTER TABLE public."InvoiceItem" OWNER TO admin;

--
-- Name: MaintenanceRequest; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."MaintenanceRequest" (
    id text NOT NULL,
    "roomId" text NOT NULL,
    title text NOT NULL,
    description text,
    status public."MaintenanceStatus" DEFAULT 'PENDING'::public."MaintenanceStatus" NOT NULL,
    "reportedBy" text,
    "resolvedAt" timestamp(3) without time zone,
    cost numeric(10,2),
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."MaintenanceRequest" OWNER TO admin;

--
-- Name: MeterReading; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."MeterReading" (
    id text NOT NULL,
    "roomId" text NOT NULL,
    month integer NOT NULL,
    year integer NOT NULL,
    "waterReading" numeric(10,2) NOT NULL,
    "electricReading" numeric(10,2) NOT NULL,
    "recordedBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."MeterReading" OWNER TO admin;

--
-- Name: MeterReplacement; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."MeterReplacement" (
    id text NOT NULL,
    "roomId" text NOT NULL,
    type public."MeterType" NOT NULL,
    "oldMeterFinalReading" numeric(10,2) NOT NULL,
    "newMeterStartReading" numeric(10,2) NOT NULL,
    "replacedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "recordedBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."MeterReplacement" OWNER TO admin;

--
-- Name: Payment; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."Payment" (
    id text NOT NULL,
    "invoiceId" text NOT NULL,
    amount numeric(10,2) NOT NULL,
    "slipImageUrl" text,
    "slipBankRef" text,
    "paidAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "verifiedBy" text,
    status public."PaymentStatus" DEFAULT 'PENDING'::public."PaymentStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Payment" OWNER TO admin;

--
-- Name: Room; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."Room" (
    id text NOT NULL,
    number text NOT NULL,
    floor integer NOT NULL,
    status public."RoomStatus" DEFAULT 'VACANT'::public."RoomStatus" NOT NULL,
    "pricePerMonth" numeric(10,2),
    "waterOverrideAmount" numeric(10,2),
    "electricOverrideAmount" numeric(10,2),
    "buildingId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Room" OWNER TO admin;

--
-- Name: RoomContact; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."RoomContact" (
    id text NOT NULL,
    "roomId" text NOT NULL,
    name text,
    phone text NOT NULL,
    "lineUserId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."RoomContact" OWNER TO admin;

--
-- Name: Tenant; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."Tenant" (
    id text NOT NULL,
    name text NOT NULL,
    nickname text,
    phone text NOT NULL,
    "idCard" text,
    "idCardImageUrl" text,
    address text,
    "lineUserId" text,
    status public."TenantStatus" DEFAULT 'ACTIVE'::public."TenantStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Tenant" OWNER TO admin;

--
-- Name: User; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public."User" (
    id text NOT NULL,
    username text NOT NULL,
    "passwordHash" text NOT NULL,
    role public."Role" DEFAULT 'ADMIN'::public."Role" NOT NULL,
    permissions jsonb,
    name text,
    phone text,
    "lineUserId" text,
    "verifyCode" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."User" OWNER TO admin;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: admin
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO admin;

--
-- Data for Name: Asset; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."Asset" (id, "roomId", name, "serialNumber", status, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Building; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."Building" (id, name, code, floors, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Contract; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."Contract" (id, "tenantId", "roomId", "startDate", "endDate", deposit, "currentRent", "occupantCount", "isActive", "contractImageUrl", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: DormConfig; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."DormConfig" (id, "dormName", address, phone, "lineId", "waterUnitPrice", "waterFeeMethod", "waterFlatMonthlyFee", "waterFlatPerPersonFee", "waterMinAmount", "waterMinUnits", "waterBaseFee", "waterTieredRates", "electricUnitPrice", "electricFeeMethod", "electricFlatMonthlyFee", "electricMinAmount", "electricMinUnits", "electricBaseFee", "electricTieredRates", "commonFee", "bankAccount", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Invoice; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."Invoice" (id, "contractId", month, year, "rentAmount", "waterAmount", "electricAmount", "otherFees", discount, "totalAmount", status, "dueDate", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: InvoiceItem; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."InvoiceItem" (id, "invoiceId", description, amount) FROM stdin;
\.


--
-- Data for Name: MaintenanceRequest; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."MaintenanceRequest" (id, "roomId", title, description, status, "reportedBy", "resolvedAt", cost, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: MeterReading; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."MeterReading" (id, "roomId", month, year, "waterReading", "electricReading", "recordedBy", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: MeterReplacement; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."MeterReplacement" (id, "roomId", type, "oldMeterFinalReading", "newMeterStartReading", "replacedAt", "recordedBy", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Payment; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."Payment" (id, "invoiceId", amount, "slipImageUrl", "slipBankRef", "paidAt", "verifiedBy", status, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Room; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."Room" (id, number, floor, status, "pricePerMonth", "waterOverrideAmount", "electricOverrideAmount", "buildingId", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: RoomContact; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."RoomContact" (id, "roomId", name, phone, "lineUserId", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Tenant; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."Tenant" (id, name, nickname, phone, "idCard", "idCardImageUrl", address, "lineUserId", status, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public."User" (id, username, "passwordHash", role, permissions, name, phone, "lineUserId", "verifyCode", "createdAt", "updatedAt") FROM stdin;
cmmc7zo2g0000krisunkpjugn	admin	$2b$10$fdnDQ84BM7MAd8HVPiPMLu2G0fawzO8rm86n4i.vct0v6a3vFppL2	ADMIN	["line_notifications", "manage_users", "view_reports", "manage_contracts", "manage_payments"]	CozyHouse Admin	\N	\N	\N	2026-03-04 15:57:17.08	2026-03-04 15:57:17.08
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: admin
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
\.


--
-- Name: Asset Asset_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Asset"
    ADD CONSTRAINT "Asset_pkey" PRIMARY KEY (id);


--
-- Name: Building Building_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Building"
    ADD CONSTRAINT "Building_pkey" PRIMARY KEY (id);


--
-- Name: Contract Contract_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Contract"
    ADD CONSTRAINT "Contract_pkey" PRIMARY KEY (id);


--
-- Name: DormConfig DormConfig_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."DormConfig"
    ADD CONSTRAINT "DormConfig_pkey" PRIMARY KEY (id);


--
-- Name: InvoiceItem InvoiceItem_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."InvoiceItem"
    ADD CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY (id);


--
-- Name: Invoice Invoice_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_pkey" PRIMARY KEY (id);


--
-- Name: MaintenanceRequest MaintenanceRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."MaintenanceRequest"
    ADD CONSTRAINT "MaintenanceRequest_pkey" PRIMARY KEY (id);


--
-- Name: MeterReading MeterReading_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."MeterReading"
    ADD CONSTRAINT "MeterReading_pkey" PRIMARY KEY (id);


--
-- Name: MeterReplacement MeterReplacement_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."MeterReplacement"
    ADD CONSTRAINT "MeterReplacement_pkey" PRIMARY KEY (id);


--
-- Name: Payment Payment_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_pkey" PRIMARY KEY (id);


--
-- Name: RoomContact RoomContact_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."RoomContact"
    ADD CONSTRAINT "RoomContact_pkey" PRIMARY KEY (id);


--
-- Name: Room Room_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Room"
    ADD CONSTRAINT "Room_pkey" PRIMARY KEY (id);


--
-- Name: Tenant Tenant_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Tenant"
    ADD CONSTRAINT "Tenant_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: Building_code_key; Type: INDEX; Schema: public; Owner: admin
--

CREATE UNIQUE INDEX "Building_code_key" ON public."Building" USING btree (code);


--
-- Name: Contract_isActive_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "Contract_isActive_idx" ON public."Contract" USING btree ("isActive");


--
-- Name: Contract_roomId_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "Contract_roomId_idx" ON public."Contract" USING btree ("roomId");


--
-- Name: Contract_tenantId_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "Contract_tenantId_idx" ON public."Contract" USING btree ("tenantId");


--
-- Name: Invoice_contractId_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "Invoice_contractId_idx" ON public."Invoice" USING btree ("contractId");


--
-- Name: Invoice_status_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "Invoice_status_idx" ON public."Invoice" USING btree (status);


--
-- Name: Invoice_year_month_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "Invoice_year_month_idx" ON public."Invoice" USING btree (year, month);


--
-- Name: MeterReading_roomId_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "MeterReading_roomId_idx" ON public."MeterReading" USING btree ("roomId");


--
-- Name: MeterReading_roomId_month_year_key; Type: INDEX; Schema: public; Owner: admin
--

CREATE UNIQUE INDEX "MeterReading_roomId_month_year_key" ON public."MeterReading" USING btree ("roomId", month, year);


--
-- Name: MeterReading_year_month_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "MeterReading_year_month_idx" ON public."MeterReading" USING btree (year, month);


--
-- Name: MeterReplacement_replacedAt_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "MeterReplacement_replacedAt_idx" ON public."MeterReplacement" USING btree ("replacedAt");


--
-- Name: MeterReplacement_roomId_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "MeterReplacement_roomId_idx" ON public."MeterReplacement" USING btree ("roomId");


--
-- Name: Payment_invoiceId_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "Payment_invoiceId_idx" ON public."Payment" USING btree ("invoiceId");


--
-- Name: Payment_status_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "Payment_status_idx" ON public."Payment" USING btree (status);


--
-- Name: RoomContact_roomId_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "RoomContact_roomId_idx" ON public."RoomContact" USING btree ("roomId");


--
-- Name: Room_buildingId_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "Room_buildingId_idx" ON public."Room" USING btree ("buildingId");


--
-- Name: Room_number_floor_buildingId_key; Type: INDEX; Schema: public; Owner: admin
--

CREATE UNIQUE INDEX "Room_number_floor_buildingId_key" ON public."Room" USING btree (number, floor, "buildingId");


--
-- Name: Room_status_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "Room_status_idx" ON public."Room" USING btree (status);


--
-- Name: Tenant_lineUserId_key; Type: INDEX; Schema: public; Owner: admin
--

CREATE UNIQUE INDEX "Tenant_lineUserId_key" ON public."Tenant" USING btree ("lineUserId");


--
-- Name: Tenant_name_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "Tenant_name_idx" ON public."Tenant" USING btree (name);


--
-- Name: Tenant_phone_key; Type: INDEX; Schema: public; Owner: admin
--

CREATE UNIQUE INDEX "Tenant_phone_key" ON public."Tenant" USING btree (phone);


--
-- Name: Tenant_status_idx; Type: INDEX; Schema: public; Owner: admin
--

CREATE INDEX "Tenant_status_idx" ON public."Tenant" USING btree (status);


--
-- Name: User_lineUserId_key; Type: INDEX; Schema: public; Owner: admin
--

CREATE UNIQUE INDEX "User_lineUserId_key" ON public."User" USING btree ("lineUserId");


--
-- Name: User_phone_key; Type: INDEX; Schema: public; Owner: admin
--

CREATE UNIQUE INDEX "User_phone_key" ON public."User" USING btree (phone);


--
-- Name: User_username_key; Type: INDEX; Schema: public; Owner: admin
--

CREATE UNIQUE INDEX "User_username_key" ON public."User" USING btree (username);


--
-- Name: Asset Asset_roomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Asset"
    ADD CONSTRAINT "Asset_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES public."Room"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Contract Contract_roomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Contract"
    ADD CONSTRAINT "Contract_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES public."Room"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Contract Contract_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Contract"
    ADD CONSTRAINT "Contract_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: InvoiceItem InvoiceItem_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."InvoiceItem"
    ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public."Invoice"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Invoice Invoice_contractId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Invoice"
    ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES public."Contract"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MaintenanceRequest MaintenanceRequest_roomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."MaintenanceRequest"
    ADD CONSTRAINT "MaintenanceRequest_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES public."Room"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MeterReading MeterReading_roomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."MeterReading"
    ADD CONSTRAINT "MeterReading_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES public."Room"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MeterReplacement MeterReplacement_roomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."MeterReplacement"
    ADD CONSTRAINT "MeterReplacement_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES public."Room"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Payment Payment_invoiceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES public."Invoice"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: RoomContact RoomContact_roomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."RoomContact"
    ADD CONSTRAINT "RoomContact_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES public."Room"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Room Room_buildingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: admin
--

ALTER TABLE ONLY public."Room"
    ADD CONSTRAINT "Room_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES public."Building"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict 4YK4ERoDFIrQRNdEopPlIEllhBmXL0qDhgSsafVHjSlXLSO34Lhed285midOOBb

