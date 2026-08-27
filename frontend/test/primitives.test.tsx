import {act, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach, describe, expect, it} from "vitest";
import {Badge} from "@/components/primitives/Badge";
import {Countdown} from "@/components/primitives/Countdown";
import {CopyAddress} from "@/components/primitives/CopyAddress";
import {Unavailable} from "@/components/primitives/Unavailable";

const FULL_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";

/** Menetapkan navigator.clipboard hanya untuk satu uji; dipulihkan di afterEach. */
function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(window.navigator, "clipboard", {
    value: {writeText},
    configurable: true,
  });
}

describe("Unavailable", () => {
  it("menamai kemampuan yang hilang dan mode yang menyediakannya", () => {
    render(<Unavailable capability="PRICE_HISTORY" mode="chain" />);
    expect(screen.getByText(/riwayat harga/i)).toBeInTheDocument();
    expect(screen.getByText(/indexer/i)).toBeInTheDocument();
  });

  /** Inti aturannya: ketidaktahuan tidak boleh menyamar jadi angka. */
  it("tidak pernah merender nol atau strip telanjang", () => {
    const {container} = render(<Unavailable capability="TRADE_TAPE" mode="chain" />);
    const text = container.textContent ?? "";
    expect(text.trim()).not.toBe("0");
    expect(text.trim()).not.toBe("—");
    expect(text.length).toBeGreaterThan(10);
  });

  /**
   * Ini perubahan status yang pengguna layar-baca perlu dengar, sama seperti
   * pengguna bermata perlu melihatnya — tanpa role="status" penjelasannya
   * hanya ada secara visual.
   */
  it("diumumkan ke pembaca layar lewat role=status", () => {
    render(<Unavailable capability="TRADE_TAPE" mode="chain" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("Badge", () => {
  it("merender labelnya", () => {
    render(<Badge tone="neutral" label="VERIFIED" />);
    expect(screen.getByText("VERIFIED")).toBeInTheDocument();
  });
});

describe("CopyAddress", () => {
  afterEach(() => {
    Object.defineProperty(window.navigator, "clipboard", {value: undefined, configurable: true});
  });

  it("menampilkan bentuk terpotong tapi menyimpan alamat penuh di title", () => {
    render(<CopyAddress address={FULL_ADDRESS} />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("0x1234…5678");
    expect(button).toHaveAttribute("title", FULL_ADDRESS);
  });

  /** Transisi ke "tersalin" adalah perubahan status; pengguna layar-baca perlu mendengarnya juga. */
  it("mengumumkan konfirmasi tersalin lewat aria-live", () => {
    render(<CopyAddress address={FULL_ADDRESS} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-live", "polite");
  });

  /**
   * Tombol tidak boleh mengklaim sukses yang belum terjadi — aturan yang sama
   * yang membuat `unavailable` jadi anggota union Query, dipindah dari data ke
   * aksi. Sebelum writeText resolve, "tersalin" belum sah muncul.
   */
  it("menampilkan 'tersalin' hanya SETELAH penulisan clipboard sungguh berhasil", async () => {
    // userEvent.setup() memasang stub clipboard-nya SENDIRI ke navigator —
    // stub kita harus dipasang SESUDAHNYA, atau tertimpa diam-diam.
    const user = userEvent.setup();
    let resolveWrite!: () => void;
    const pending = new Promise<void>((res) => {
      resolveWrite = res;
    });
    stubClipboard(() => pending);

    render(<CopyAddress address={FULL_ADDRESS} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).not.toHaveTextContent("tersalin");

    await act(async () => {
      resolveWrite();
      await pending;
    });
    expect(screen.getByRole("button")).toHaveTextContent("tersalin");
  });

  it("tidak mengklaim tersalin saat penulisan clipboard gagal (promise reject)", async () => {
    const user = userEvent.setup();
    let rejectWrite!: (reason: unknown) => void;
    const pending = new Promise<void>((_resolve, rej) => {
      rejectWrite = rej;
    });
    stubClipboard(() => pending);

    render(<CopyAddress address={FULL_ADDRESS} />);
    await user.click(screen.getByRole("button"));
    await act(async () => {
      rejectWrite(new Error("izin ditolak"));
      await pending.catch(() => {});
    });
    expect(screen.getByRole("button")).toHaveTextContent("0x1234…5678");
  });

  it("tidak mengklaim tersalin saat clipboard API tidak tersedia", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, "clipboard", {value: undefined, configurable: true});

    render(<CopyAddress address={FULL_ADDRESS} />);
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("0x1234…5678");
  });
});

describe("Countdown", () => {
  it("memformat sisa waktu dari stempel waktu absolut", () => {
    const now = 1_790_000_000;
    render(<Countdown until={now + 2 * 3600 + 14 * 60} nowSeconds={now} />);
    expect(screen.getByText("2j 14m")).toBeInTheDocument();
  });

  it("menyatakan tutup saat sudah lewat", () => {
    const now = 1_790_000_000;
    render(<Countdown until={now - 60} nowSeconds={now} />);
    expect(screen.getByText("tutup")).toBeInTheDocument();
  });
});
