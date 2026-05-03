"""
ResNet-34 + UNet decoder with:
  - CBAM attention in bottleneck
  - Deep supervision aux heads at /8 and /4
  - Wider decoder (dec2 = 128ch)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F

try:
    from torchvision.models import resnet34, ResNet34_Weights
    TORCHVISION_AVAILABLE = True
except ImportError:
    TORCHVISION_AVAILABLE = False

try:
    from huggingface_hub import hf_hub_download
    HF_AVAILABLE = True
except ImportError:
    HF_AVAILABLE = False


class DoubleConv(nn.Module):
    def __init__(self, in_ch, out_ch, dropout=0.0):
        super().__init__()
        layers = [
            nn.Conv2d(in_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch), nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch), nn.ReLU(inplace=True),
        ]
        if dropout > 0:
            layers.append(nn.Dropout2d(dropout))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


class CBAM(nn.Module):
    def __init__(self, channels, reduction=16):
        super().__init__()
        self.ch_avg = nn.AdaptiveAvgPool2d(1)
        self.ch_max = nn.AdaptiveMaxPool2d(1)
        self.ch_mlp = nn.Sequential(
            nn.Flatten(),
            nn.Linear(channels, channels//reduction, bias=False),
            nn.ReLU(),
            nn.Linear(channels//reduction, channels, bias=False),
        )
        self.sp_conv = nn.Conv2d(2, 1, 7, padding=3, bias=False)

    def forward(self, x):
        avg = self.ch_mlp(self.ch_avg(x))
        mx  = self.ch_mlp(self.ch_max(x))
        ca  = torch.sigmoid(avg + mx).view(x.size(0), -1, 1, 1)
        x   = x * ca
        sp  = torch.cat([x.mean(1, keepdim=True), x.max(1, keepdim=True).values], 1)
        return x * torch.sigmoid(self.sp_conv(sp))


class AttentionGate(nn.Module):
    def __init__(self, F_g, F_l, F_int):
        super().__init__()
        self.W_g = nn.Sequential(nn.Conv2d(F_g, F_int, 1, bias=False), nn.BatchNorm2d(F_int))
        self.W_x = nn.Sequential(nn.Conv2d(F_l, F_int, 1, bias=False), nn.BatchNorm2d(F_int))
        self.psi = nn.Sequential(nn.Conv2d(F_int, 1, 1, bias=False), nn.BatchNorm2d(1), nn.Sigmoid())

    def forward(self, g, x):
        g1 = self.W_g(g)
        x1 = self.W_x(x)
        if g1.shape != x1.shape:
            g1 = F.interpolate(g1, size=x1.shape[2:], mode="bilinear", align_corners=False)
        return x * self.psi(F.relu(g1 + x1, inplace=True))


class _DecoderBlock(nn.Module):
    def __init__(self, in_ch, skip_ch, out_ch, dropout=0.0):
        super().__init__()
        self.up   = nn.ConvTranspose2d(in_ch, out_ch, 2, stride=2)
        self.conv = DoubleConv(out_ch + skip_ch, out_ch, dropout=dropout)

    def forward(self, x, skip=None):
        x = self.up(x)
        if skip is not None:
            if x.shape != skip.shape:
                x = F.interpolate(x, size=skip.shape[2:], mode="bilinear", align_corners=False)
            x = torch.cat([x, skip], dim=1)
        return self.conv(x)


class _FallbackUNet(nn.Module):
    def __init__(self, in_channels=1, num_classes=2, dropout=0.2):
        super().__init__()
        self.enc1 = DoubleConv(in_channels, 64)
        self.enc2 = DoubleConv(64, 128)
        self.enc3 = DoubleConv(128, 256)
        self.pool = nn.MaxPool2d(2)
        self.bottleneck = nn.Sequential(DoubleConv(256, 512, dropout=dropout), CBAM(512))
        self.att3 = AttentionGate(256, 256, 128)
        self.att2 = AttentionGate(128, 128, 64)
        self.att1 = AttentionGate(64,  64,  32)
        self.up3  = nn.ConvTranspose2d(512, 256, 2, stride=2)
        self.dec3 = DoubleConv(512, 256, dropout=dropout)
        self.up2  = nn.ConvTranspose2d(256, 128, 2, stride=2)
        self.dec2 = DoubleConv(256, 128)
        self.up1  = nn.ConvTranspose2d(128, 64, 2, stride=2)
        self.dec1 = DoubleConv(128, 64)
        self.final = nn.Conv2d(64, num_classes, 1)
        self.aux_head1 = nn.Conv2d(256, num_classes, 1)
        self.aux_head2 = nn.Conv2d(128, num_classes, 1)
        self._aux_feat1 = None
        self._aux_feat2 = None
        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
            elif isinstance(m, nn.BatchNorm2d):
                nn.init.constant_(m.weight, 1); nn.init.constant_(m.bias, 0)

    def forward(self, x):
        e1 = self.enc1(x)
        e2 = self.enc2(self.pool(e1))
        e3 = self.enc3(self.pool(e2))
        b  = self.bottleneck(self.pool(e3))
        up3 = self.up3(b)
        d3  = self.dec3(torch.cat([up3, self.att3(up3, e3)], 1))
        self._aux_feat1 = d3
        up2 = self.up2(d3)
        d2  = self.dec2(torch.cat([up2, self.att2(up2, e2)], 1))
        self._aux_feat2 = d2
        up1 = self.up1(d2)
        d1  = self.dec1(torch.cat([up1, self.att1(up1, e1)], 1))
        return self.final(d1)


class ResNetUNet(nn.Module):
    def __init__(self, num_classes=2, dropout=0.2, pretrained=True):
        super().__init__()
        if not TORCHVISION_AVAILABLE:
            raise ImportError("torchvision not installed.")

        weights  = ResNet34_Weights.IMAGENET1K_V1 if pretrained else None
        backbone = resnet34(weights=weights)

        orig  = backbone.conv1
        new_c = nn.Conv2d(1, 64, 7, stride=2, padding=3, bias=False)
        with torch.no_grad():
            new_c.weight = nn.Parameter(orig.weight.mean(dim=1, keepdim=True))
        backbone.conv1 = new_c

        self.enc0 = nn.Sequential(backbone.conv1, backbone.bn1, backbone.relu)
        self.pool = backbone.maxpool
        self.enc1 = backbone.layer1   # 64
        self.enc2 = backbone.layer2   # 128
        self.enc3 = backbone.layer3   # 256
        self.enc4 = backbone.layer4   # 512

        self.bottleneck = nn.Sequential(DoubleConv(512, 512, dropout=dropout), CBAM(512))

        self.dec4 = _DecoderBlock(512, 256, 256, dropout=dropout)
        self.dec3 = _DecoderBlock(256, 128, 128, dropout=dropout)
        self.dec2 = _DecoderBlock(128, 64,  128)
        self.dec1 = _DecoderBlock(128, 64,  64)
        self.dec0 = _DecoderBlock(64,  0,   32)

        self.final = nn.Conv2d(32, num_classes, 1)

        self.aux_head1 = nn.Sequential(
            nn.Conv2d(128, 64, 3, padding=1, bias=False),
            nn.BatchNorm2d(64), nn.ReLU(inplace=True),
            nn.Conv2d(64, num_classes, 1),
        )
        self.aux_head2 = nn.Sequential(
            nn.Conv2d(128, 64, 3, padding=1, bias=False),
            nn.BatchNorm2d(64), nn.ReLU(inplace=True),
            nn.Conv2d(64, num_classes, 1),
        )
        self._aux_feat1 = None
        self._aux_feat2 = None

    def forward(self, x):
        e0 = self.enc0(x)
        e1 = self.enc1(self.pool(e0))
        e2 = self.enc2(e1)
        e3 = self.enc3(e2)
        e4 = self.enc4(e3)
        b  = self.bottleneck(e4)
        d4 = self.dec4(b,  e3)
        d3 = self.dec3(d4, e2)
        self._aux_feat1 = d3
        d2 = self.dec2(d3, e1)
        self._aux_feat2 = d2
        d1 = self.dec1(d2, e0)
        d0 = self.dec0(d1, None)
        return self.final(d0)


class _CardiacResNetEncoder(nn.Module):
    REPO = "nickcoutsos/medicalnet-resnet34-2d"
    FILE = "resnet34_2d.pth"

    @classmethod
    def try_load(cls, num_classes=2, dropout=0.2):
        model = ResNetUNet(num_classes=num_classes, dropout=dropout, pretrained=True)
        if not HF_AVAILABLE:
            print("Warning: huggingface_hub not installed - using ImageNet weights.")
            return model
        try:
            print("Downloading cardiac-pretrained encoder weights...")
            ckpt  = hf_hub_download(repo_id=cls.REPO, filename=cls.FILE)
            state = torch.load(ckpt, map_location="cpu")
            state = {k.replace("encoder.", ""): v for k, v in state.items()}
            if "conv1.weight" in state and state["conv1.weight"].shape[1] != 1:
                state["conv1.weight"] = state["conv1.weight"].mean(dim=1, keepdim=True)
            enc_keys = {"enc0","enc1","enc2","enc3","enc4","pool"}
            filtered = {k: v for k,v in state.items() if any(k.startswith(p) for p in enc_keys)}
            missing, unexpected = model.load_state_dict(filtered, strict=False)
            print(f"Loaded {len(filtered)-len(missing)} tensors. "
                  f"Missing={len(missing)}, Unexpected={len(unexpected)}")
        except Exception as e:
            print(f"Warning: Cardiac weight download failed ({e}). Using ImageNet weights.")
        return model


def UNetResNet34(in_channels=1, num_classes=2, dropout=0.2,
           pretrained=True, cardiac_pretrained=True):
    if not TORCHVISION_AVAILABLE:
        print("torchvision not found - using attention UNet fallback")
        return _FallbackUNet(in_channels=in_channels, num_classes=num_classes, dropout=dropout)
    if cardiac_pretrained and pretrained:
        #print("Attempting cardiac-pretrained ResNet-34 encoder...")
        return _CardiacResNetEncoder.try_load(num_classes=num_classes, dropout=dropout)
    print("Using ResNet-34 ImageNet pretrained encoder")
    return ResNetUNet(num_classes=num_classes, dropout=dropout, pretrained=pretrained)
