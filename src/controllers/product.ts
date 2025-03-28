import { UploadApiResponse } from "cloudinary";
import { RequestHandler } from "express";
import ProductModel from "src/models/product";
import { sendErrorRes } from "src/utils/helper";
import cloudUploader, { cloudApi } from "src/cloud";
import { isValidObjectId } from "mongoose";


const uploadImage = (filePath: string): Promise<UploadApiResponse> => {
    return cloudUploader.upload(filePath, {
        width: 1280,
        height: 720,
        crop: "fill",
    });
};


// 새 상품 등록
export const listNewProduct: RequestHandler = async (req, res) => {

    // 1. 요청 바디에서 제품 정보 추출
    const { name, price, category, description, purchasingDate } = req.body;

    // 2. 상품 모델 생성
    const newProduct = new ProductModel({
        owner: req.user.id,
        name,
        price,
        category,
        description,
        purchasingDate,
    });

    // 3. 요청에서 이미지 파일 추출
    const { images } = req.files;
    const isMultipleImages = Array.isArray(images);

    // 4. 이미지 수량 제한 (최대 5개)
    if (isMultipleImages && images.length > 5) {
        return sendErrorRes(res, "Image files can not be more than 5!", 422);
    }

    // 5. 이미지 타입 유효성 검사
    let invalidFileType = false;
    if (isMultipleImages) { // 5-1. 다중 이미지 경우
        for (let img of images) {
            if (!img.mimetype?.startsWith("image")) {
                invalidFileType = true;
                break;
            }
        }
    }
    else { // 5-2. 단일 이미지 경우
        if (images) {
            if (!images.mimetype?.startsWith("image")) {
                invalidFileType = true;
            }
        }
    }

    // 6. 유효하지 않은 파일 타입 에러 반환
    if (invalidFileType) return sendErrorRes(res, "Invalid file type, files must be image type!", 422);

    // 7. 파일 업로드 처리
    if (isMultipleImages) {
        // 7-1. 다중 이미지 업로드
        const uploadPromise = images.map((file) => uploadImage(file.filepath));
        
        // 7-2. 모든 파일 업로드 완료 대기 (모든 이미지가 성공적으로 업로드되었는지 확인, 하나라도 실패 시 전체 트랜잭션 관리해야 함)
        const uploadResults = await Promise.all(uploadPromise);

        // 7-3. 업로드된 이미지 정보를 제품 모델에 저장
        newProduct.images = uploadResults.map(({ secure_url, public_id }) => {
            return { 
                url: secure_url, 
                id: public_id 
            };
        });

        // 7-4. 첫 번째 이미지를 썸네일로 설정
        newProduct.thumbnail = newProduct.images[0].url;
    }
    else {
        if (images) { // 7-5. 단일 이미지 업로드
            const { secure_url, public_id } = await uploadImage(images.filepath);
            newProduct.images = [
                { 
                    url: secure_url, 
                    id: public_id 
                }
            ];

            // 7-6. 썸네일 설정 (단일 이미지인 경우)
            newProduct.thumbnail = secure_url;
        }
    }

    // 8. 제품 저장
    await newProduct.save();

    // 9. 성공 응답 반환
    res.status(201).json({ message: "Added new product!" });

}




// 상품 수정
export const updateProduct: RequestHandler = async (req, res) => {

    // 1. 요청 바디에서 제품 정보 추출
    const { name, price, category, description, purchasingDate, thumbnail } = req.body;

    // 2. URL 파라미터에서 상품 ID 추출 및 유효성 검사
    const productId = req.params.id;
    if (!isValidObjectId(productId)) return sendErrorRes(res, "Invalid product id!", 422);

    // 3. 상품 찾기 및 업데이트 (소유자 일치 확인)
    const product = await ProductModel.findOneAndUpdate(
        { 
            _id: productId, // 요청된 상품 ID로 문서 검색
            owner: req.user.id // 현재 로그인한 사용자가 소유한 상품인지 확인
        },
        {
            name, // 상품명 업데이트
            price, // 가격 업데이트
            category, // 카테고리 업데이트
            description, // 설명 업데이트
            purchasingDate, // 구매일자 업데이트
        }, 
        {
            new: true, // true: 업데이트 후의 문서 반환, false: 업데이트 전 문서 반환
        },
    );

    // 4. 상품이 존재하지 않거나 소유자가 일치하지 않는 경우 에러 반환
    if (!product) return sendErrorRes(res, "Product not found!", 404);

    // 5. 썸네일 업데이트 (문자열인 경우에만)
    if (typeof thumbnail === "string") {
        product.thumbnail = thumbnail
    };

    // 6. 요청에서 이미지 파일 추출
    const { images } = req.files;
    const isMultipleImages = Array.isArray(images);

    // 7. 이미지 수량 제한 (최대 5개) 확인
    if (isMultipleImages) {
        const oldImages = product.images?.length || 0;
        if (oldImages + images.length > 5) {
            return sendErrorRes(res, "Image files can not be more than 5!", 422);
        }
    }

    // 8. 이미지 타입 유효성 검사
    let invalidFileType = false;

    if (isMultipleImages) { // 8-1. 다중 이미지 경우
        for (let img of images) {
            if (!img.mimetype?.startsWith("image")) {
            invalidFileType = true;
            break;
            }
        }
    } 
    else { // 8-2. 단일 이미지 경우
        if (images) {
            if (!images.mimetype?.startsWith("image")) {
                invalidFileType = true;
            }
        }
    }

    // 9. 유효하지 않은 파일 타입 에러 반환
    if (invalidFileType) return sendErrorRes(res, "Invalid file type, files must be image type!", 422);
    

    // 10. 파일 업로드 처리
    if (isMultipleImages) { // 10-1. 다중 이미지 업로드
        const uploadPromise = images.map((file) => uploadImage(file.filepath));
        const uploadResults = await Promise.all(uploadPromise);
        const newImages = uploadResults.map(({ secure_url, public_id }) => {
            return { 
                url: secure_url, 
                id: public_id 
            };
        });

        // 10-2. 기존 이미지 배열에 새 이미지 추가
        if (product.images) {
            product.images.push(...newImages);
        }
        else {
            product.images = newImages;
        }
    } 
    else { // 10-3. 단일 이미지 업로드
        if (images) {
            const { secure_url, public_id } = await uploadImage(images.filepath);
            if (product.images) {
                product.images.push({ 
                    url: secure_url, 
                    id: public_id 
                });
            }
            else {
                product.images = [{ 
                    url: secure_url, 
                    id: public_id 
                }];
            }
        }
    }

    // 11. 수정된 상품 정보 저장
    await product.save();

    // 12. 성공 응답 반환
    res.status(201).json({ message: "Product updated successfully." });

}




// 상품 삭제
export const deleteProduct: RequestHandler = async (req, res) => {

    // 1. URL 파라미터에서 상품 ID 추출 및 유효성 검사
    const productId = req.params.id;
    if (!isValidObjectId(productId)) return sendErrorRes(res, "Invalid product id!", 422);

    // 2. 상품 찾기 및 삭제 (소유자 일치 확인)
    const product = await ProductModel.findOneAndDelete({
        _id: productId, // 요청된 상품 ID로 문서 검색
        owner: req.user.id, // 현재 로그인한 사용자가 소유한 상품인지 확인
    });

    // 3. 상품이 존재하지 않거나 소유자가 일치하지 않는 경우 에러 반환
    if (!product) return sendErrorRes(res, "Product not found!", 404);

    // 4. 클라우드에서 연결된 이미지 파일 삭제
    const images = product.images || [];
    if (images.length) {
        const ids = images.map(({ id }) => id); // 이미지 ID 배열 추출
        await cloudApi.delete_resources(ids); // 클라우드에서 해당 이미지 리소스 삭제
    }

    // 5. 성공 응답 반환
    res.json({ message: "Product removed successfully." });

}




// 상품 이미지 삭제
export const deleteProductImage: RequestHandler = async (req, res) => {

    // 1. URL 파라미터에서 상품 ID와 이미지 ID 추출 및 유효성 검사
    const { productId, imageId } = req.params;
    if (!isValidObjectId(productId)) return sendErrorRes(res, "Invalid product id!", 422);

    // 2. 상품 찾기 및 이미지 제거 (소유자 일치 확인)
    const product = await ProductModel.findOneAndUpdate(
        { 
            _id: productId, 
            owner: req.user.id 
        },
        {
            $pull: { // MongoDB $pull 연산자를 사용하여 배열에서 특정 요소 제거
                images: { // 'images' 배열에서
                    id: imageId // 'id'가 요청된 imageId와 일치하는 객체 제거
                },
            },
        },
        { 
            new: true 
        }
    );

    // 3. 상품이 존재하지 않거나 소유자가 일치하지 않는 경우 에러 반환
    if (!product) return sendErrorRes(res, "Product not found!", 404);

    // 4. 삭제된 이미지가 썸네일인 경우 처리 (썸네일로 사용되던 이미지가 삭제되더라도 제품 정보의 일관성 유지)
    if (product.thumbnail?.includes(imageId)) { // 현재 썸네일 URL에 삭제된 이미지 ID가 포함되어 있는지 확인
        const images = product.images; // 남아있는 이미지 배열 가져오기
        if (images) { // 다른 이미지가 있는지 확인
            product.thumbnail = images[0].url; // 첫 번째 남은 이미지를 새 썸네일로 설정
        }
        else { // 남은 이미지가 없는 경우
            product.thumbnail = ""; // 썸네일을 빈 문자열로 설정
        }
        await product.save(); // 변경된 썸네일 정보 저장
    }

    // 5. 클라우드에서 이미지 파일 삭제
    await cloudUploader.destroy(imageId);

    // 6. 성공 응답 반환
    res.json({ message: "Image removed successfully." });
}